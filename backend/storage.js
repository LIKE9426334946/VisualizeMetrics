import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function removeReferences(saved, ids, folders) {
  if (!saved) return null;
  const value = saved.value;
  value.datasets = (value.datasets ?? []).filter((item) => !ids.has(item.id));
  value.seriesPrefs = Object.fromEntries(
    Object.entries(value.seriesPrefs ?? {}).filter(
      ([key]) => !ids.has(key.split(":")[0]),
    ),
  );
  value.openFiles = (value.openFiles ?? []).filter((id) => !ids.has(id));
  if (ids.has(value.tableId)) value.tableId = value.datasets[0]?.id ?? "";
  if (ids.has((value.statsId ?? "").split(":")[0])) value.statsId = "";
  if (!folders.some((folder) => folder.id === value.activeFolderId))
    value.activeFolderId = folders[0]?.id ?? "";
  return saved;
}

export class FileStore {
  constructor(directory) {
    this.directory = directory;
    this.indexPath = path.join(directory, "index.json");
    this.tail = Promise.resolve();
  }

  async init() {
    await mkdir(path.join(this.directory, "uploads"), { recursive: true });
    try {
      this.data = JSON.parse(await readFile(this.indexPath, "utf8"));
      if (
        this.data.version !== 1 ||
        !Array.isArray(this.data.folders) ||
        !Array.isArray(this.data.files)
      )
        throw new Error("Invalid data/index.json schema");
    } catch (error) {
      // Never replace a damaged or unreadable index with an empty catalog.
      if (error.code !== "ENOENT") throw error;
      this.data = {
        version: 1,
        folders: [
          {
            id: randomUUID(),
            name: "默认目录",
            createdAt: new Date().toISOString(),
          },
        ],
        files: [],
        workspace: null,
        clientSequences: {},
      };
      await this.persist(this.data);
    }
    return this;
  }

  async persist(next) {
    const temporary = `${this.indexPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(next, null, 2), {
        mode: 0o600,
      });
      await rename(temporary, this.indexPath);
      this.data = next;
    } finally {
      await rm(temporary, { force: true });
    }
  }

  mutate(action) {
    const result = this.tail.then(action);
    this.tail = result.catch(() => {});
    return result;
  }

  snapshot() {
    const { folders, files, workspace } = this.data;
    return structuredClone({ folders, files, workspace });
  }

  file(id) {
    const file = this.data.files.find((item) => item.id === id);
    if (!file) throw httpError(404, "CSV 文件不存在，可能已被删除。");
    return {
      ...file,
      path: path.join(
        this.directory,
        "uploads",
        file.folderId,
        `${file.id}.csv`,
      ),
    };
  }

  createFolder(name) {
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.trim().length > 80 ||
      /[\u0000-\u001f/\\]/.test(name)
    )
      throw httpError(
        400,
        "目录名称需要 1–80 个字符，不能包含斜杠或控制字符。",
      );
    return this.mutate(async () => {
      if (this.data.folders.some((folder) => folder.name === name.trim()))
        throw httpError(409, "已存在同名目录。");
      const folder = {
        id: randomUUID(),
        name: name.trim(),
        createdAt: new Date().toISOString(),
      };
      const next = structuredClone(this.data);
      next.folders.push(folder);
      await this.persist(next);
      return folder;
    });
  }

  upload(folderId, filename, buffer, rowCount) {
    return this.mutate(async () => {
      if (!this.data.folders.some((folder) => folder.id === folderId))
        throw httpError(404, "上传目录不存在，请重新选择目录。");
      const file = {
        id: randomUUID(),
        folderId,
        filename,
        size: buffer.length,
        rowCount,
        createdAt: new Date().toISOString(),
      };
      const directory = path.join(this.directory, "uploads", folderId);
      const destination = path.join(directory, `${file.id}.csv`);
      await mkdir(directory, { recursive: true });
      await writeFile(destination, buffer, { flag: "wx", mode: 0o600 });
      try {
        const next = structuredClone(this.data);
        next.files.push(file);
        await this.persist(next);
      } catch (error) {
        await rm(destination, { force: true });
        throw error;
      }
      return file;
    });
  }

  deleteFile(id) {
    return this.mutate(async () => {
      const file = this.file(id);
      const next = structuredClone(this.data);
      next.files = next.files.filter((item) => item.id !== id);
      next.workspace = removeReferences(
        next.workspace,
        new Set([id]),
        next.folders,
      );
      await this.persist(next);
      await rm(file.path, { force: true });
      return { deletedFileIds: [id] };
    });
  }

  deleteFolder(id) {
    return this.mutate(async () => {
      if (!this.data.folders.some((folder) => folder.id === id))
        throw httpError(404, "目录不存在，可能已被删除。");
      const ids = new Set(
        this.data.files
          .filter((file) => file.folderId === id)
          .map((file) => file.id),
      );
      const next = structuredClone(this.data);
      next.folders = next.folders.filter((folder) => folder.id !== id);
      next.files = next.files.filter((file) => !ids.has(file.id));
      next.workspace = removeReferences(next.workspace, ids, next.folders);
      await this.persist(next);
      await rm(path.join(this.directory, "uploads", id), {
        recursive: true,
        force: true,
      });
      return { deletedFileIds: [...ids] };
    });
  }

  saveWorkspace({ clientId, sequence, value }) {
    if (
      typeof clientId !== "string" ||
      !/^[\w-]{1,100}$/.test(clientId) ||
      !Number.isSafeInteger(sequence) ||
      sequence < 1 ||
      !value ||
      typeof value !== "object" ||
      !Array.isArray(value.datasets) ||
      !Array.isArray(value.selected) ||
      !value.settings ||
      !["files", "demo"].includes(value.mode)
    )
      throw httpError(400, "工作区数据格式无效。");
    return this.mutate(async () => {
      // A late keepalive request from a closing tab must not overwrite newer edits.
      if (sequence <= (this.data.clientSequences[clientId] ?? 0))
        return { saved: false };
      const next = structuredClone(this.data);
      const validIds = new Set(next.files.map((file) => file.id));
      const cleaned = structuredClone(value);
      const allowedDemoIds = new Set(["demo0", "demo1", "demo2"]);
      cleaned.datasets = cleaned.datasets.filter(
        (item) =>
          item &&
          (validIds.has(item.id) ||
            (cleaned.mode === "demo" && allowedDemoIds.has(item.id))),
      );
      next.workspace = removeReferences(
        {
          value: cleaned,
          clientId,
          sequence,
          updatedAt: new Date().toISOString(),
        },
        new Set(),
        next.folders,
      );
      next.clientSequences[clientId] = sequence;
      await this.persist(next);
      return { saved: true, updatedAt: next.workspace.updatedAt };
    });
  }
}
