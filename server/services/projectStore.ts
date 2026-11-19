import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PROJECTS_ROOT_DIR, PROJECT_TTL_MS } from '../config.ts';

export interface StoredProject {
  id: string;
  dir: string;
  rendersDir: string;
  originalPath: string;
  filename: string;
  duration: number;
  width: number;
  height: number;
  sizeBytes: number;
  hasAudio: boolean;
  isDemo: boolean;
  createdAt: number;
  lastAccessedAt: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{16,64}$/i;

const projects = new Map<string, StoredProject>();

export function ensureProjectsRoot(): void {
  fs.mkdirSync(PROJECTS_ROOT_DIR, { recursive: true });
}

export function isValidProjectId(id: string): boolean {
  return UUID_RE.test(id);
}

export function isValidRenderHash(hash: string): boolean {
  return HASH_RE.test(hash);
}

export function createProjectDirectory(): { id: string; dir: string; rendersDir: string } {
  ensureProjectsRoot();
  const id = crypto.randomUUID();
  const dir = path.join(PROJECTS_ROOT_DIR, id);
  const rendersDir = path.join(dir, 'renders');
  fs.mkdirSync(rendersDir, { recursive: true });
  return { id, dir, rendersDir };
}

export function registerProject(project: StoredProject): StoredProject {
  projects.set(project.id, project);
  return project;
}

export function getProject(id: string): StoredProject | null {
  if (!isValidProjectId(id)) {
    return null;
  }
  const project = projects.get(id);
  if (!project) {
    return null;
  }
  if (!fs.existsSync(project.originalPath)) {
    projects.delete(id);
    return null;
  }
  project.lastAccessedAt = Date.now();
  return project;
}

export function getRenderFilePath(project: StoredProject, renderHash: string): string | null {
  if (!isValidRenderHash(renderHash)) {
    return null;
  }
  const filePath = path.join(project.rendersDir, `${renderHash}.mp4`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  project.lastAccessedAt = Date.now();
  return filePath;
}

export function removeProject(id: string): boolean {
  if (!isValidProjectId(id)) {
    return false;
  }
  const project = projects.get(id);
  projects.delete(id);
  const targetDir = project ? project.dir : path.join(PROJECTS_ROOT_DIR, id);
  try {
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    return true;
  } catch {
    return false;
  }
}

export function sweepExpiredProjects(): void {
  const now = Date.now();
  for (const [id, project] of projects.entries()) {
    if (now - project.lastAccessedAt > PROJECT_TTL_MS) {
      removeProject(id);
    }
  }

  // Also clean stale orphaned directories left from previous server runs
  if (fs.existsSync(PROJECTS_ROOT_DIR)) {
    try {
      const entries = fs.readdirSync(PROJECTS_ROOT_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (projects.has(entry.name)) continue;
        const fullPath = path.join(PROJECTS_ROOT_DIR, entry.name);
        try {
          const stat = fs.statSync(fullPath);
          if (now - stat.mtimeMs > PROJECT_TTL_MS) {
            fs.rmSync(fullPath, { recursive: true, force: true });
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }
}

export function startProjectCleanupTimer(): void {
  ensureProjectsRoot();
  sweepExpiredProjects();
  const timer = setInterval(sweepExpiredProjects, 10 * 60 * 1000);
  timer.unref();
}
