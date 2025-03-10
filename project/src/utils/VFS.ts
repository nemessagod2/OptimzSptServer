import "reflect-metadata";
import crypto from "node:crypto";
import fs from "node:fs";
import path, { resolve } from "node:path";
import { promisify } from "node:util";
import { IAsyncQueue } from "@spt/models/spt/utils/IAsyncQueue";
import { writeFileSync } from "atomically";
import { checkSync, lockSync, unlockSync } from "proper-lockfile";
import { Worker } from "node:worker_threads";
import { inject, injectable } from "tsyringe";

@injectable()
export class VFS {
    private accessFilePromisify = promisify(fs.access);
    private copyFilePromisify = promisify(fs.copyFile);
    private mkdirPromisify = promisify(fs.mkdir);
    private readFilePromisify = promisify(fs.readFile);
    private writeFilePromisify = promisify(fs.writeFile);
    private readdirPromisify = promisify(fs.readdir);
    private statPromisify = promisify(fs.stat);
    private unlinkPromisify = promisify(fs.unlink);
    private rmdirPromisify = promisify(fs.rmdir);
    private renamePromisify = promisify(fs.rename);

    constructor(@inject("AsyncQueue") private asyncQueue: IAsyncQueue) { }

    /**
     * Check if a file or directory exists synchronously
     * @param filepath Path to check
     * @returns True if exists, false otherwise
     */
    public exists(filepath: fs.PathLike): boolean {
        return fs.existsSync(filepath);
    }

    /**
     * Check if a file or directory exists asynchronously
     * @param filepath Path to check
     * @returns Promise resolving to true if exists, false otherwise
     */
    public async existsAsync(filepath: fs.PathLike): Promise<boolean> {
        return this.queueCommand(() => this.accessFilePromisify(filepath))
            .then(() => true)
            .catch(() => false);
    }

    /**
     * Copy a file synchronously
     * @param filepath Source path
     * @param target Destination path
     */
    public copyFile(filepath: fs.PathLike, target: fs.PathLike): void {
        fs.copyFileSync(filepath, target);
    }

    /**
     * Copy a file asynchronously
     * @param filepath Source path
     * @param target Destination path
     */
    public async copyAsync(filepath: fs.PathLike, target: fs.PathLike): Promise<void> {
        await this.queueCommand(() => this.copyFilePromisify(filepath, target));
    }

    /**
     * Create a directory synchronously
     * @param filepath Path to create
     */
    public createDir(filepath: string): void {
        fs.mkdirSync(filepath.substr(0, filepath.lastIndexOf("/")), { recursive: true });
    }

    /**
     * Create a directory asynchronously
     * @param filepath Path to create
     */
    public async createDirAsync(filepath: string): Promise<void> {
        await this.queueCommand(() =>
            this.mkdirPromisify(filepath.substr(0, filepath.lastIndexOf("/")), { recursive: true })
        );
    }

    /**
     * Copy a directory and its contents synchronously
     * @param filepath Source directory
     * @param target Destination directory
     * @param fileExtensions Optional file extensions to filter
     */
    public copyDir(filepath: string, target: string, fileExtensions?: string | string[]): void {
        const files = this.getFiles(filepath);
        const dirs = this.getDirs(filepath);

        if (!this.exists(target)) this.createDir(`${target}/`);

        for (const dir of dirs) {
            this.copyDir(path.join(filepath, dir), path.join(target, dir), fileExtensions);
        }

        for (const file of files) {
            if (!fileExtensions || this.matchesExtension(file, fileExtensions)) {
                this.copyFile(path.join(filepath, file), path.join(target, file));
            }
        }
    }

    /**
     * Copy a directory and its contents asynchronously
     * @param filepath Source directory
     * @param target Destination directory
     * @param fileExtensions Optional file extensions to filter
     */
    public async copyDirAsync(filepath: string, target: string, fileExtensions?: string | string[]): Promise<void> {
        const [files, dirs] = await Promise.all([this.getFilesAsync(filepath), this.getDirsAsync(filepath)]);

        if (!(await this.existsAsync(target))) await this.createDirAsync(`${target}/`);

        await Promise.all([
            ...dirs.map((dir) => this.copyDirAsync(path.join(filepath, dir), path.join(target, dir), fileExtensions)),
            ...files.map((file) =>
                !fileExtensions || this.matchesExtension(file, fileExtensions)
                    ? this.copyAsync(path.join(filepath, file), path.join(target, file))
                    : Promise.resolve()
            ),
        ]);
    }

    /**
     * Read a file synchronously
     * @param filepath Path to file
     * @returns File content as string
     */
    public readFile(filepath: fs.PathLike, options?: fs.ObjectEncodingOptions): string {
        const content = fs.readFileSync(filepath, options);
        return Buffer.isBuffer(content) ? content.toString() : content;
    }

    /**
     * Read a file asynchronously
     * @param filepath Path to file
     * @returns Promise resolving to file content as string
     */
    public async readFileAsync(filepath: fs.PathLike): Promise<string> {
        const content = await this.readFilePromisify(filepath);
        return Buffer.isBuffer(content) ? content.toString() : content;
    }

    /**
     * Write to a file synchronously
     * @param filepath Path to file
     * @param data Data to write
     * @param append Whether to append or overwrite
     * @param atomic Use atomic write
     */
    public writeFile(filepath: string, data = "", append = false, atomic = true): void {
        const options = append ? { flag: "a" } : { flag: "w" };
        if (!this.exists(filepath)) {
            this.createDir(filepath);
            fs.writeFileSync(filepath, "");
        }

        const release = this.lockFileSync(filepath);
        try {
            if (!append && atomic) {
                writeFileSync(filepath, data);
            } else {
                fs.writeFileSync(filepath, data, options);
            }
        } finally {
            release();
        }
    }

    /**
     * Write to a file asynchronously
     * @param filepath Path to file
     * @param data Data to write
     * @param append Whether to append or overwrite
     * @param atomic Use atomic write
     */
    public async writeFileAsync(filepath: string, data = "", append = false, atomic = true): Promise<void> {
        const options = append ? { flag: "a" } : { flag: "w" };
        if (!(await this.existsAsync(filepath))) {
            await this.createDirAsync(filepath);
            await this.writeFilePromisify(filepath, "");
        }

        const release = this.lockFileSync(filepath);
        try {
            if (!append && atomic) {
                await this.writeFilePromisify(filepath, data);
            } else {
                await this.writeFilePromisify(filepath, data, options);
            }
        } finally {
            release();
        }
    }

    /**
     * Get list of files in a directory synchronously
     * @param filepath Directory path
     * @returns Array of file names
     */
    public getFiles(filepath: string): string[] {
        return fs.readdirSync(filepath).filter((item) => fs.statSync(path.join(filepath, item)).isFile());
    }

    /**
     * Get list of files in a directory asynchronously
     * @param filepath Directory path
     * @returns Promise resolving to array of file names
     */
    public async getFilesAsync(filepath: string): Promise<string[]> {
        const items = await this.readdirPromisify(filepath);
        const stats = await Promise.all(items.map((item) => this.statPromisify(path.join(filepath, item))));
        return items.filter((_, index) => stats[index].isFile());
    }

    /**
     * Get list of directories in a directory synchronously
     * @param filepath Directory path
     * @returns Array of directory names
     */
    public getDirs(filepath: string): string[] {
        return fs.readdirSync(filepath).filter((item) => fs.statSync(path.join(filepath, item)).isDirectory());
    }

    /**
     * Get list of directories in a directory asynchronously
     * @param filepath Directory path
     * @returns Promise resolving to array of directory names
     */
    public async getDirsAsync(filepath: string): Promise<string[]> {
        const items = await this.readdirPromisify(filepath);
        const stats = await Promise.all(items.map((item) => this.statPromisify(path.join(filepath, item))));
        return items.filter((_, index) => stats[index].isDirectory());
    }

    /**
     * Remove a file synchronously
     * @param filepath Path to file
     */
    public removeFile(filepath: string): void {
        fs.unlinkSync(filepath);
    }

    /**
     * Remove a file asynchronously
     * @param filepath Path to file
     */
    public async removeFileAsync(filepath: string): Promise<void> {
        await this.unlinkPromisify(filepath);
    }

    /**
     * Remove a directory and its contents synchronously
     * @param filepath Directory path
     */
    public removeDir(filepath: string): void {
        const files = this.getFiles(filepath);
        const dirs = this.getDirs(filepath);

        for (const dir of dirs) this.removeDir(path.join(filepath, dir));
        for (const file of files) this.removeFile(path.join(filepath, file));
        fs.rmdirSync(filepath);
    }

    /**
     * Remove a directory and its contents asynchronously
     * @param filepath Directory path
     */
    public async removeDirAsync(filepath: string): Promise<void> {
        const [files, dirs] = await Promise.all([this.getFilesAsync(filepath), this.getDirsAsync(filepath)]);
        await Promise.all([
            ...dirs.map((dir) => this.removeDirAsync(path.join(filepath, dir))),
            ...files.map((file) => this.removeFileAsync(path.join(filepath, file))),
        ]);
        await this.rmdirPromisify(filepath);
    }

    /**
     * Rename a file or directory synchronously
     * @param oldPath Current path
     * @param newPath New path
     */
    public rename(oldPath: string, newPath: string): void {
        fs.renameSync(oldPath, newPath);
    }

    /**
     * Rename a file or directory asynchronously
     * @param oldPath Current path
     * @param newPath New path
     */
    public async renameAsync(oldPath: string, newPath: string): Promise<void> {
        await this.renamePromisify(oldPath, newPath);
    }

    /**
     * Minify all JSON files in a directory recursively (synchronous)
     * @param filepath Directory path
     */
    public async minifyAllJsonInDirRecursive(filepath: string): Promise<void> {
        const files = this.getFiles(filepath).filter((item) => this.getFileExtension(item) === "json");
        const dirs = this.getDirs(filepath);

        for (const file of files) {
            const filePath = path.join(filepath, file);
            const content = this.readFile(filePath);
            const minified = JSON.stringify(JSON.parse(content));
            this.writeFile(filePath, minified);
        }

        await Promise.all(dirs.map((dir) => this.minifyAllJsonInDirRecursive(path.join(filepath, dir))));
    }

    /**
     * Minify all JSON files in a directory recursively (asynchronous with workers)
     * @param filepath Directory path
     */
    public async minifyAllJsonInDirRecursiveAsync(filepath: string): Promise<void> {
        const files = (await this.getFilesAsync(filepath)).filter((item) => this.getFileExtension(item) === "json");
        const dirs = await this.getDirsAsync(filepath);

        const workerPromises = files.map((file) => this.minifyJsonInWorker(path.join(filepath, file)));
        await Promise.all([...workerPromises, ...dirs.map((dir) => this.minifyAllJsonInDirRecursiveAsync(path.join(filepath, dir)))]);
    }

    /**
     * Get all files of a specific type recursively
     * @param directory Starting directory
     * @param fileType File extension to filter
     * @param files Accumulated file list
     * @returns Array of file paths
     */
    public getFilesOfType(directory: string, fileType: string, files: string[] = []): string[] {
        if (!fs.existsSync(directory)) return files;

        const dirents = fs.readdirSync(directory, { encoding: "utf-8", withFileTypes: true });
        for (const dirent of dirents) {
            const res = resolve(directory, dirent.name);
            if (dirent.isDirectory()) {
                this.getFilesOfType(res, fileType, files);
            } else if (res.endsWith(fileType)) {
                files.push(res);
            }
        }
        return files;
    }

    /**
     * Get file extension from a path
     * @param filepath File path
     * @returns Extension or undefined
     */
    public getFileExtension(filepath: string): string | undefined {
        return filepath.split(".").pop();
    }

    /**
     * Remove extension from a file path
     * @param filepath File path
     * @returns Path without extension
     */
    public stripExtension(filepath: string): string {
        return filepath.split(".").slice(0, -1).join(".");
    }

    /**
     * Execute a command through the async queue
     * @param cmd Command to execute
     * @returns Promise resolving to command result
     */
    private async queueCommand<T>(cmd: () => Promise<T>): Promise<T> {
        const command = { uuid: crypto.randomUUID(), cmd };
        return this.asyncQueue.waitFor(command);
    }

    /**
     * Check if a file matches any of the provided extensions
     * @param file File name
     * @param extensions Extensions to match
     * @returns True if matches, false otherwise
     */
    private matchesExtension(file: string, extensions: string | string[]): boolean {
        const ext = file.split(".").pop() ?? "";
        return Array.isArray(extensions) ? extensions.includes(ext) : ext === extensions;
    }

    /**
     * Minify a JSON file in a worker thread
     * @param filePath Path to JSON file
     * @returns Promise resolving when minification is complete
     */
    private minifyJsonInWorker(filePath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const worker = new Worker(
                `
                const { parentPort, workerData } = require("worker_threads");
                const fs = require("fs");
                const content = fs.readFileSync(workerData.filePath, "utf8");
                const minified = JSON.stringify(JSON.parse(content));
                fs.writeFileSync(workerData.filePath, minified);
                parentPort.postMessage("done");
            `,
                {
                    eval: true,
                    workerData: { filePath },
                }
            );

            worker.on("message", () => resolve());
            worker.on("error", reject);
            worker.on("exit", (code) => {
                if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
            });
        });
    }

    protected lockFileSync(filepath: string): () => void {
        return lockSync(filepath);
    }

    protected checkFileSync(filepath: string): boolean {
        return checkSync(filepath);
    }

    protected unlockFileSync(filepath: string): void {
        unlockSync(filepath);
    }
}
