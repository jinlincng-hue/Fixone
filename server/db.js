import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const serverDir = __dirname;
export const projectRoot = path.resolve(__dirname, "..");
export const uploadRoot = path.join(__dirname, "uploads", "repair-projects");
export const dbPath = process.env.DB_PATH || path.join(__dirname, "fixone.db");

fs.mkdirSync(uploadRoot, { recursive: true });

function runSql(sql) {
  execFileSync("sqlite3", [dbPath, sql], { encoding: "utf8" });
}

function allSql(sql) {
  const output = execFileSync("sqlite3", ["-json", dbPath, sql], { encoding: "utf8" }).trim();
  if (!output) return [];
  return JSON.parse(output);
}

function getSql(sql) {
  return allSql(sql)[0];
}

function q(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function n(value) {
  if (value === null || value === undefined || value === "") return "NULL";
  const num = Number(value);
  return Number.isFinite(num) ? String(num) : "NULL";
}

runSql(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS repair_video_projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    uploader_name TEXT NOT NULL,
    uploader_username TEXT NOT NULL,
    contact TEXT NOT NULL DEFAULT '',
    brand TEXT,
    series TEXT,
    model TEXT NOT NULL,
    repair_part TEXT NOT NULL,
    description TEXT,
    license_agreed INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS uploaded_clips (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    clip_order INTEGER NOT NULL,
    clip_title TEXT NOT NULL,
    clip_description TEXT,
    video_file_path TEXT NOT NULL,
    original_filename TEXT,
    file_size INTEGER,
    mime_type TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (project_id) REFERENCES repair_video_projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS password_reset_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'reset',
    used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    expires_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime', '+10 minutes'))
  );

  CREATE TABLE IF NOT EXISTS video_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    username TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (project_id) REFERENCES repair_video_projects(id) ON DELETE CASCADE,
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_video_comments_project_created
    ON video_comments(project_id, created_at DESC, id DESC);

  CREATE TABLE IF NOT EXISTS user_sessions (
    token_hash TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_user_sessions_username
    ON user_sessions(username);
`);

function ensureColumn(table, column, definition) {
  const columns = allSql(`PRAGMA table_info(${table})`).map((item) => item.name);
  if (!columns.includes(column)) {
    runSql(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("repair_video_projects", "category", "TEXT");
ensureColumn("repair_video_projects", "device_model", "TEXT");
ensureColumn("repair_video_projects", "video_file_path", "TEXT");
ensureColumn("repair_video_projects", "original_filename", "TEXT");
ensureColumn("repair_video_projects", "file_size", "INTEGER");
ensureColumn("repair_video_projects", "mime_type", "TEXT");
ensureColumn("users", "email", "TEXT");

function thumbnailPathForVideo(videoFilePath) {
  const value = String(videoFilePath || "");
  if (!value) return "";
  const thumbnailPath = value.replace(/\/[^/]+$/, "/thumbnail.jpg");
  const localPath = path.join(projectRoot, "server", thumbnailPath.replace(/^\/+/, ""));
  return fs.existsSync(localPath) ? thumbnailPath : "";
}

export function normalizeProject(row) {
  if (!row) return row;
  return {
    ...row,
    category: row.category || row.repair_part || "其他",
    device_model: row.device_model || row.model || "",
    video_file_path: row.video_file_path || "",
    thumbnail_file_path: thumbnailPathForVideo(row.video_file_path || ""),
  };
}

export function getAllProjects() {
  return allSql(`
    SELECT *
    FROM repair_video_projects
    ORDER BY created_at DESC
  `).map(normalizeProject);
}

export function getProjectById(id) {
  return normalizeProject(getSql(`
    SELECT *
    FROM repair_video_projects
    WHERE id = ${q(id)}
  `));
}

export function insertProject(project) {
  runSql(`
    INSERT INTO repair_video_projects (
      id, title, uploader_name, uploader_username, contact,
      brand, series, model, repair_part, description, license_agreed, status,
      category, device_model, video_file_path, original_filename, file_size, mime_type
    ) VALUES (
      ${q(project.id)}, ${q(project.title)}, ${q(project.uploader_name)}, ${q(project.uploader_username)}, ${q(project.contact)},
      ${q(project.brand)}, ${q(project.series)}, ${q(project.model)}, ${q(project.repair_part)}, ${q(project.description)}, ${n(project.license_agreed)}, ${q(project.status)},
      ${q(project.category)}, ${q(project.device_model)}, ${q(project.video_file_path)}, ${q(project.original_filename)}, ${n(project.file_size)}, ${q(project.mime_type)}
    )
  `);
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/iphone/g, "iphone")
    .replace(/苹果/g, "iphone");
}

function uniqueChineseChars(value) {
  return Array.from(new Set(String(value || "").match(/[\u4e00-\u9fff]/g) || []));
}

function searchTokens(query) {
  const sanitized = String(query || "").trim();
  const tokens = new Set();
  for (const segment of sanitized.split(/\s+/)) {
    if (!segment) continue;
    tokens.add(normalizeSearchText(segment));
    if (/[\u4e00-\u9fff]/.test(segment)) {
      for (const ch of segment) tokens.add(ch);
    }
  }
  if (sanitized) tokens.add(normalizeSearchText(sanitized));
  return Array.from(tokens).filter(Boolean);
}

function scoreSearchProject(project, query) {
  const queryText = normalizeSearchText(query);
  const tokens = searchTokens(query);
  const title = normalizeSearchText(project.title);
  const description = normalizeSearchText(project.description);
  const device = normalizeSearchText(project.device_model || project.model);
  const category = normalizeSearchText(project.category || project.repair_part);
  const searchable = [title, description, device, category].join("");
  let score = 0;

  if (title === queryText) score += 120;
  else if (title.includes(queryText)) score += 85;
  else if (searchable.includes(queryText)) score += 55;

  for (const token of tokens) {
    if (title.includes(token)) score += token.length > 1 ? 18 : 7;
    if (device.includes(token)) score += token.length > 1 ? 12 : 4;
    if (category.includes(token)) score += 6;
    if (description.includes(token)) score += token.length > 1 ? 5 : 2;
  }

  const queryChars = uniqueChineseChars(queryText);
  if (queryChars.length) {
    const titleOverlap = queryChars.filter((ch) => title.includes(ch)).length;
    const allOverlap = queryChars.filter((ch) => searchable.includes(ch)).length;
    score += (titleOverlap / queryChars.length) * 30;
    score += (allOverlap / queryChars.length) * 12;
  }

  return Math.round(score);
}

export function searchApprovedProjects(query) {
  const sanitized = String(query || "").trim();
  if (!sanitized) return { projects: [], relatedProjects: [] };

  const scored = allSql(`
    SELECT *
    FROM repair_video_projects
    WHERE status = 'approved'
    ORDER BY created_at DESC
    LIMIT 200
  `)
    .map(normalizeProject)
    .map((project) => ({
      ...project,
      relevance_score: scoreSearchProject(project, sanitized)
    }))
    .filter((project) => project.relevance_score > 0)
    .sort((a, b) => b.relevance_score - a.relevance_score || String(b.created_at).localeCompare(String(a.created_at)));

  const projects = scored.slice(0, 6);
  const usedIds = new Set(projects.map((project) => project.id));
  const relatedProjects = scored
    .filter((project) => !usedIds.has(project.id))
    .slice(0, 12);

  return { projects, relatedProjects };
}

export function updateProjectStatus(id, status) {
  runSql(`
    UPDATE repair_video_projects
    SET status = ${q(status)}
    WHERE id = ${q(id)}
  `);
}

export function updateProject(project) {
  runSql(`
    UPDATE repair_video_projects
    SET
      title = ${q(project.title)},
      description = ${q(project.description)},
      category = ${q(project.category)},
      device_model = ${q(project.device_model)},
      model = ${q(project.device_model)},
      repair_part = ${q(project.category)},
      status = ${q(project.status)},
      video_file_path = ${q(project.video_file_path)},
      original_filename = ${q(project.original_filename)},
      file_size = ${n(project.file_size)},
      mime_type = ${q(project.mime_type)}
    WHERE id = ${q(project.id)}
  `);
}

export function getProjectsByUploader(username) {
  return allSql(`
    SELECT *
    FROM repair_video_projects
    WHERE uploader_username = ${q(username)}
    ORDER BY created_at DESC
  `).map(normalizeProject);
}

export function deleteProject(projectId) {
  runSql(`DELETE FROM video_comments WHERE project_id = ${q(projectId)}`);
  runSql(`DELETE FROM repair_video_projects WHERE id = ${q(projectId)}`);
}

export function getVideoComments(projectId) {
  return allSql(`
    SELECT
      video_comments.id,
      video_comments.project_id,
      video_comments.username,
      users.display_name,
      video_comments.content,
      video_comments.created_at
    FROM video_comments
    INNER JOIN users ON users.username = video_comments.username
    WHERE video_comments.project_id = ${q(projectId)}
    ORDER BY datetime(video_comments.created_at) DESC, video_comments.id DESC
    LIMIT 100
  `);
}

export function getLatestVideoComment(projectId, username) {
  return getSql(`
    SELECT created_at
    FROM video_comments
    WHERE project_id = ${q(projectId)} AND username = ${q(username)}
    ORDER BY id DESC
    LIMIT 1
  `);
}

export function insertVideoComment({ projectId, username, content }) {
  runSql(`
    INSERT INTO video_comments (project_id, username, content)
    VALUES (${q(projectId)}, ${q(username)}, ${q(content)})
  `);
  return getSql(`
    SELECT
      video_comments.id,
      video_comments.project_id,
      video_comments.username,
      users.display_name,
      video_comments.content,
      video_comments.created_at
    FROM video_comments
    INNER JOIN users ON users.username = video_comments.username
    WHERE video_comments.project_id = ${q(projectId)} AND video_comments.username = ${q(username)}
    ORDER BY video_comments.id DESC
    LIMIT 1
  `);
}

export function createUser({ username, display_name, password_hash, email }) {
  runSql(`
    INSERT INTO users (username, display_name, password_hash, email)
    VALUES (${q(username)}, ${q(display_name)}, ${q(password_hash)}, ${q(email || "")})
  `);
  return { changes: 1 };
}

export function deleteUserAndProjects(username) {
  const projects = getProjectsByUploader(username);
  for (const project of projects) {
    deleteProject(project.id);
  }
  runSql(`DELETE FROM video_comments WHERE username = ${q(username)}`);
  runSql(`DELETE FROM user_sessions WHERE username = ${q(username)}`);
  runSql(`DELETE FROM users WHERE username = ${q(username)}`);
  return { changes: 1 };
}

export function getUserByUsername(username) {
  return getSql(`
    SELECT * FROM users WHERE username = ${q(username)}
  `);
}

export function getUserByEmail(email) {
  return getSql(`
    SELECT * FROM users WHERE LOWER(email) = LOWER(${q(email)}) LIMIT 1
  `);
}

export function getUserByUsernameOrEmail(value) {
  return getSql(`
    SELECT * FROM users
    WHERE username = ${q(value)} OR LOWER(email) = LOWER(${q(value)})
    LIMIT 1
  `);
}

export function insertUserSession({ tokenHash, username }) {
  runSql(`
    DELETE FROM user_sessions
    WHERE username = ${q(username)} OR expires_at <= datetime('now', 'localtime');
    INSERT INTO user_sessions (token_hash, username, expires_at)
    VALUES (${q(tokenHash)}, ${q(username)}, datetime('now', 'localtime', '+30 days'));
  `);
}

export function getUserBySessionHash(tokenHash) {
  return getSql(`
    SELECT users.*
    FROM user_sessions
    INNER JOIN users ON users.username = user_sessions.username
    WHERE user_sessions.token_hash = ${q(tokenHash)}
      AND user_sessions.expires_at > datetime('now', 'localtime')
    LIMIT 1
  `);
}

export function updateUserEmail(username, email) {
  runSql(`
    UPDATE users SET email = ${q(email)} WHERE username = ${q(username)}
  `);
}

export function updateUserPassword(username, passwordHash) {
  runSql(`
    UPDATE users SET password_hash = ${q(passwordHash)} WHERE username = ${q(username)}
  `);
}

export function insertResetCode({ username, email, code, purpose }) {
  runSql(`
    UPDATE password_reset_codes SET used = 1
    WHERE username = ${q(username)} AND purpose = ${q(purpose)} AND used = 0
  `);
  runSql(`
    INSERT INTO password_reset_codes (username, email, code, purpose)
    VALUES (${q(username)}, ${q(email)}, ${q(code)}, ${q(purpose)})
  `);
}

export function findValidResetCode({ username, code, purpose }) {
  return getSql(`
    SELECT * FROM password_reset_codes
    WHERE username = ${q(username)}
      AND code = ${q(code)}
      AND purpose = ${q(purpose)}
      AND used = 0
      AND expires_at > datetime('now', 'localtime')
    ORDER BY id DESC
    LIMIT 1
  `);
}

export function markResetCodeUsed(id) {
  runSql(`UPDATE password_reset_codes SET used = 1 WHERE id = ${n(id)}`);
}

export function getLastResetCodeSentAt({ username, purpose }) {
  const row = getSql(`
    SELECT created_at FROM password_reset_codes
    WHERE username = ${q(username)} AND purpose = ${q(purpose)}
    ORDER BY id DESC LIMIT 1
  `);
  return row ? row.created_at : null;
}
