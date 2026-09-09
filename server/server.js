import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import express from "express";
import multer from "multer";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import {
  searchApprovedProjects,
  getAllProjects,
  getProjectById,
  insertProject,
  projectRoot,
  getProjectsByUploader,
  deleteProject,
  updateProjectStatus,
  updateProject,
  uploadRoot,
  createUser,
  getUserByUsername,
  getUserByEmail,
  getUserByUsernameOrEmail,
  updateUserEmail,
  updateUserPassword,
  insertResetCode,
  findValidResetCode,
  markResetCodeUsed,
  getLastResetCodeSentAt,
  deleteUserAndProjects,
  getVideoComments,
  getLatestVideoComment,
  insertVideoComment,
  insertUserSession,
  getUserBySessionHash
} from "./db.js";

const app = express();
const port = Number(process.env.PORT || 3000);

// ===== 邮件服务（QQ 邮箱 SMTP，凭据走环境变量，不写进代码） =====
const smtpConfig = {
  host: process.env.SMTP_HOST || "smtp.qq.com",
  port: Number(process.env.SMTP_PORT || 465),
  user: process.env.SMTP_USER || "",
  pass: process.env.SMTP_PASS || ""
};
const CODE_TTL_MINUTES = 10;
const CODE_SEND_INTERVAL_MS = 60 * 1000;
const lastCodeSentAt = new Map(); // 内存限流：key = purpose:username

function isEmailConfigured() {
  return Boolean(smtpConfig.user && smtpConfig.pass);
}

function isValidEmail(value) {
  return /^[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(String(value || "").trim());
}

function generateCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function createUserSession(username) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  insertUserSession({ tokenHash, username });
  return token;
}

function authenticatedUser(req) {
  const authorization = String(req.headers.authorization || "");
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return null;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  return getUserBySessionHash(tokenHash) || null;
}

async function sendCodeEmail(to, code, purposeLabel) {
  if (!isEmailConfigured()) {
    throw new Error("邮件服务未配置，请联系管理员");
  }
  const transporter = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.port === 465,
    auth: { user: smtpConfig.user, pass: smtpConfig.pass }
  });
  await transporter.sendMail({
    from: `"Fixone视修工坊" <${smtpConfig.user}>`,
    to,
    subject: `Fixone ${purposeLabel}验证码：${code}`,
    text: `你的 Fixone ${purposeLabel}验证码是 ${code}，${CODE_TTL_MINUTES} 分钟内有效。如果这不是你本人的操作，请忽略本邮件。`
  });
}

function checkSendCooldown(username, purpose) {
  const key = `${purpose}:${username}`;
  const last = lastCodeSentAt.get(key) || 0;
  if (Date.now() - last < CODE_SEND_INTERVAL_MS) {
    const waitSeconds = Math.ceil((CODE_SEND_INTERVAL_MS - (Date.now() - last)) / 1000);
    throw new Error(`发送太频繁，请 ${waitSeconds} 秒后再试`);
  }
}

function markCodeSent(username, purpose) {
  lastCodeSentAt.set(`${purpose}:${username}`, Date.now());
}
// ===== 邮件服务结束 =====

const allowedExts = new Set([".mp4", ".mov", ".webm"]);
const allowedMimes = new Set(["video/mp4", "video/quicktime", "video/webm", "application/octet-stream"]);
const allowedCategories = new Set(["水电维修", "门窗维修", "家电维修", "手机维修", "其他"]);

app.use(express.json());

const publicFiles = [
  "index.html",
  "profile.html",
  "upload-project.html",
  "admin-projects.html",
  "repair-player.html",
  "favicon.ico",
  "style.css",
  "script.js"
];

app.get("/", (req, res) => {
  res.sendFile(path.join(projectRoot, "index.html"));
});

publicFiles.forEach((file) => {
  app.get(`/${file}`, (req, res) => {
    res.sendFile(path.join(projectRoot, file));
  });
});

app.use("/assets", express.static(path.join(projectRoot, "assets")));
app.use("/data", express.static(path.join(projectRoot, "data")));
app.use("/uploads", express.static(path.join(projectRoot, "server", "uploads")));

const storage = multer.diskStorage({
  destination(req, file, callback) {
    if (!req.projectUploadId) req.projectUploadId = crypto.randomUUID();
    const targetDir = path.join(uploadRoot, req.projectUploadId);
    fs.mkdirSync(targetDir, { recursive: true });
    callback(null, targetDir);
  },
  filename(req, file, callback) {
    const ext = path.extname(file.originalname || "").toLowerCase();
    callback(null, `${crypto.randomUUID()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024
  },
  fileFilter(req, file, callback) {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (!allowedExts.has(ext) || !allowedMimes.has(file.mimetype)) {
      callback(new Error("只允许上传 mp4、mov、webm 视频文件"));
      return;
    }
    callback(null, true);
  }
});

function cleanupProjectFolder(projectId) {
  if (!projectId) return;
  const target = path.join(uploadRoot, projectId);
  const resolved = path.resolve(target);
  if (!resolved.startsWith(path.resolve(uploadRoot))) return;
  fs.rmSync(resolved, { recursive: true, force: true });
}

function compactAscii(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "");
}

function normalizeUploaderName(username) {
  const compact = compactAscii(username).toLowerCase();
  const withoutFixPrefix = compact.startsWith("fix") && compact.length > 3 ? compact.slice(3) : compact;
  return withoutFixPrefix || "member";
}

function normalizeSlugPart(value) {
  const compact = compactAscii(value);
  return compact || "RepairVideo";
}

function buildProjectName({ uploaderUsername, title, deviceModel, sequence }) {
  const ownerPart = normalizeUploaderName(uploaderUsername);
  const devicePart = normalizeSlugPart(deviceModel || title).slice(0, 36);
  const sequencePart = String(sequence).padStart(2, "0");
  return `${ownerPart}${devicePart}${sequencePart}`;
}

function getAvailableProjectName({ uploaderUsername, title, deviceModel }) {
  let sequence = 1;
  let projectName = buildProjectName({ uploaderUsername, title, deviceModel, sequence });

  while (getProjectById(projectName) || fs.existsSync(path.join(uploadRoot, projectName))) {
    sequence += 1;
    projectName = buildProjectName({ uploaderUsername, title, deviceModel, sequence });
  }

  return projectName;
}

function getVideoCodec(filePath) {
  try {
    const stdout = execFileSync("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=codec_name",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath
    ], { encoding: "utf8", timeout: 15000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function transcodeToH264(filePath) {
  const codec = getVideoCodec(filePath);
  if (!codec || codec === "h264") return false;

  const tmpPath = `${filePath}.transcode.tmp.mp4`;
  try {
    console.log(`[transcode] start ${filePath} (${codec} -> h264)`);
    execFileSync("ffmpeg", [
      "-i", filePath,
      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      "-y", tmpPath
    ], { encoding: "utf8", timeout: 300000, stdio: "pipe" });
    fs.renameSync(tmpPath, filePath);
    console.log(`[transcode] done ${filePath}`);
    return true;
  } catch (error) {
    console.error(`[transcode] failed ${filePath}:`, error.message);
    try { fs.rmSync(tmpPath, { force: true }); } catch {}
    return false;
  }
}

function getVideoDuration(filePath) {
  try {
    const stdout = execFileSync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath
    ], { encoding: "utf8", timeout: 15000 });
    const duration = Number(stdout.trim());
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  } catch {
    return 0;
  }
}

function generateVideoThumbnail(filePath, thumbnailPath) {
  const duration = getVideoDuration(filePath);
  const midpoint = duration > 0 ? Math.max(0.1, duration / 2) : 0.1;
  try {
    execFileSync("ffmpeg", [
      "-ss", String(midpoint),
      "-i", filePath,
      "-frames:v", "1",
      "-vf", "scale=320:-1",
      "-q:v", "3",
      "-y", thumbnailPath
    ], { encoding: "utf8", timeout: 60000, stdio: "pipe" });
    return true;
  } catch (error) {
    console.error(`[thumbnail] failed ${filePath}:`, error.message);
    try { fs.rmSync(thumbnailPath, { force: true }); } catch {}
    return false;
  }
}

function requireText(body, key, label) {
  const value = String(body[key] || "").trim();
  if (!value) throw new Error(`${label}不能为空`);
  return value;
}

function webPathForFile(projectId, filename) {
  return `/uploads/repair-projects/${projectId}/${filename}`;
}

function saveSingleVideo({ tempUploadId, projectName, file }) {
  if (!file) throw new Error("请上传维修教学视频");

  const finalDir = path.join(uploadRoot, projectName);
  const resolvedFinalDir = path.resolve(finalDir);
  if (!resolvedFinalDir.startsWith(path.resolve(uploadRoot))) throw new Error("项目保存路径不合法");

  fs.mkdirSync(finalDir, { recursive: false });
  const ext = path.extname(file.originalname || file.filename || ".mp4").toLowerCase();
  const filename = `${projectName}${ext}`;
  const targetPath = path.join(finalDir, filename);
  fs.renameSync(file.path, targetPath);
  transcodeToH264(targetPath);
  generateVideoThumbnail(targetPath, path.join(finalDir, "thumbnail.jpg"));
  cleanupProjectFolder(tempUploadId);

  return {
    filename,
    path: targetPath,
    videoFilePath: webPathForFile(projectName, filename)
  };
}

app.post("/api/repair-video-projects", (req, res) => {
  upload.single("video_file")(req, res, (uploadError) => {
    const tempUploadId = req.projectUploadId || "";
    let projectName = "";

    try {
      if (uploadError) throw uploadError;

      const uploaderName = requireText(req.body, "uploader_name", "上传者姓名");
      const uploaderUsername = requireText(req.body, "uploader_username", "上传者账号");
      const title = requireText(req.body, "title", "标题");
      const description = requireText(req.body, "description", "简介");
      const category = requireText(req.body, "category", "维修大类");
      const deviceModel = requireText(req.body, "device_model", "设备名称和型号");
      if (!allowedCategories.has(category)) throw new Error("维修大类不合法");

      projectName = getAvailableProjectName({ uploaderUsername, title, deviceModel });
      const savedVideo = saveSingleVideo({ tempUploadId, projectName, file: req.file });

      insertProject({
        id: projectName,
        title,
        uploader_name: uploaderName,
        uploader_username: uploaderUsername,
        contact: "",
        brand: "",
        series: "",
        model: deviceModel,
        repair_part: category,
        description,
        license_agreed: 1,
        status: "pending",
        category,
        device_model: deviceModel,
        video_file_path: savedVideo.videoFilePath,
        original_filename: req.file.originalname,
        file_size: req.file.size,
        mime_type: req.file.mimetype
      });

      res.json({
        success: true,
        message: "维修教学视频提交成功，等待管理员审核",
        projectId: projectName,
        projectName
      });
    } catch (error) {
      cleanupProjectFolder(tempUploadId);
      cleanupProjectFolder(projectName);
      res.status(400).json({
        success: false,
        message: error.message || "上传失败"
      });
    }
  });
});

app.get("/api/repair-video-projects/:id/detail", (req, res) => {
  const username = String(req.query.username || "").trim();
  const project = getProjectById(req.params.id);

  if (!project) {
    res.status(404).json({ success: false, message: "项目不存在" });
    return;
  }

  if (project.uploader_username !== username && project.status !== "approved") {
    res.status(403).json({ success: false, message: "无权查看该视频" });
    return;
  }

  res.json({ success: true, project });
});

app.patch("/api/repair-video-projects/:id", (req, res) => {
  upload.single("video_file")(req, res, (uploadError) => {
    const tempUploadId = req.projectUploadId || "";
    const projectId = req.params.id;

    try {
      if (uploadError) throw uploadError;

      const project = getProjectById(projectId);
      if (!project) {
        throw new Error("项目不存在");
      }

      const uploaderUsername = requireText(req.body, "uploader_username", "上传者账号");
      if (project.uploader_username !== uploaderUsername) {
        res.status(403).json({ success: false, message: "无权编辑他人的视频" });
        cleanupProjectFolder(tempUploadId);
        return;
      }

      const title = requireText(req.body, "title", "标题");
      const description = requireText(req.body, "description", "简介");
      const category = requireText(req.body, "category", "维修大类");
      const deviceModel = requireText(req.body, "device_model", "设备名称和型号");
      if (!allowedCategories.has(category)) throw new Error("维修大类不合法");

      let videoFilePath = project.video_file_path;
      let originalFilename = project.original_filename;
      let fileSize = project.file_size;
      let mimeType = project.mime_type;

      if (req.file) {
        cleanupProjectFolder(projectId);
        const savedVideo = saveSingleVideo({ tempUploadId, projectName: projectId, file: req.file });
        videoFilePath = savedVideo.videoFilePath;
        originalFilename = req.file.originalname;
        fileSize = req.file.size;
        mimeType = req.file.mimetype;
      } else {
        cleanupProjectFolder(tempUploadId);
      }

      updateProject({
        id: projectId,
        title,
        description,
        category,
        device_model: deviceModel,
        status: "pending",
        video_file_path: videoFilePath,
        original_filename: originalFilename,
        file_size: fileSize,
        mime_type: mimeType
      });

      res.json({
        success: true,
        message: "维修教学视频已更新，等待管理员重新审核",
        projectId
      });
    } catch (error) {
      cleanupProjectFolder(tempUploadId);
      res.status(400).json({
        success: false,
        message: error.message || "保存失败"
      });
    }
  });
});

app.get("/api/admin/repair-video-projects", (req, res) => {
  res.json({ projects: getAllProjects() });
});

app.get("/api/admin/repair-video-projects/:id/clips", (req, res) => {
  const project = getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ message: "项目不存在" });
    return;
  }

  res.json({
    project,
    clips: project.video_file_path ? [{
      id: project.id,
      clip_order: 1,
      clip_title: project.title,
      clip_description: project.description,
      videoUrl: project.video_file_path,
      status: project.status,
      created_at: project.created_at
    }] : []
  });
});

app.patch("/api/admin/repair-video-projects/:id/status", (req, res) => {
  const allowedStatuses = new Set(["approved", "rejected", "needs_reupload", "pending"]);
  const status = String(req.body.status || "");
  if (!allowedStatuses.has(status)) {
    res.status(400).json({ success: false, message: "状态不合法" });
    return;
  }

  const project = getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ success: false, message: "项目不存在" });
    return;
  }

  updateProjectStatus(req.params.id, status);
  res.json({ success: true, message: "项目状态已更新" });
});

app.patch("/api/admin/repair-video-projects/:id/approve-all", (req, res) => {
  const project = getProjectById(req.params.id);
  if (!project) {
    res.status(404).json({ success: false, message: "项目不存在" });
    return;
  }

  updateProjectStatus(req.params.id, "approved");
  res.json({ success: true, message: "项目已通过审核" });
});

app.patch("/api/admin/uploaded-clips/:id/status", (req, res) => {
  res.status(410).json({ success: false, message: "切片审核已移除，请直接审核教学视频项目" });
});

app.get("/api/repair-video-projects/:projectId/playlist", (req, res) => {
  const isAdmin = req.query.admin === "true";
  const project = getProjectById(req.params.projectId);
  if (!project) {
    res.status(404).json({ message: "项目不存在" });
    return;
  }
  if (!isAdmin && project.status !== "approved") {
    res.json({ project, clips: [], message: "该视频尚未审核通过" });
    return;
  }

  res.json({
    project: {
      id: project.id,
      title: project.title,
      description: project.description,
      category: project.category,
      device_model: project.device_model,
      uploader_name: project.uploader_name,
      created_at: project.created_at,
      videoUrl: project.video_file_path,
      status: project.status
    },
    clips: project.video_file_path ? [{
      id: project.id,
      clipOrder: 1,
      clipTitle: project.title,
      clipDescription: project.description,
      videoUrl: project.video_file_path,
      status: project.status
    }] : [],
    message: project.video_file_path ? "" : "暂无视频文件"
  });
});

app.get("/api/repair-video-projects/:projectId/comments", (req, res) => {
  const project = getProjectById(req.params.projectId);
  if (!project || project.status !== "approved") {
    res.status(404).json({ success: false, message: "视频不存在或尚未发布" });
    return;
  }

  const comments = getVideoComments(project.id);
  res.json({ success: true, comments, count: comments.length });
});

app.post("/api/repair-video-projects/:projectId/comments", (req, res) => {
  try {
    const project = getProjectById(req.params.projectId);
    if (!project || project.status !== "approved") {
      return res.status(404).json({ success: false, message: "视频不存在或尚未发布" });
    }

    const content = String(req.body.content || "").trim();
    const user = authenticatedUser(req);
    if (!user) return res.status(401).json({ success: false, message: "登录已过期，请重新登录后评论" });
    if (!content) return res.status(400).json({ success: false, message: "请输入评论内容" });
    if (content.length > 500) {
      return res.status(400).json({ success: false, message: "评论不能超过 500 个字" });
    }

    const latest = getLatestVideoComment(project.id, user.username);
    if (latest?.created_at) {
      const elapsed = Date.now() - new Date(latest.created_at.replace(" ", "T")).getTime();
      if (elapsed >= 0 && elapsed < 15 * 1000) {
        return res.status(429).json({ success: false, message: "评论发送太快，请稍后再试" });
      }
    }

    const comment = insertVideoComment({ projectId: project.id, username: user.username, content });
    return res.status(201).json({ success: true, message: "评论发表成功", comment });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "评论发表失败" });
  }
});

app.get("/api/my-projects", (req, res) => {
  const username = String(req.query.username || "").trim();
  if (!username) {
    res.status(400).json({ message: "缺少用户名参数" });
    return;
  }
  res.json({ projects: getProjectsByUploader(username) });
});

app.delete("/api/repair-video-projects/:id", (req, res) => {
  const projectId = req.params.id;
  const username = String(req.query.username || "").trim();

  const project = getProjectById(projectId);
  if (!project) {
    res.status(404).json({ success: false, message: "项目不存在" });
    return;
  }
  if (project.uploader_username !== username) {
    res.status(403).json({ success: false, message: "无权删除他人的项目" });
    return;
  }

  cleanupProjectFolder(projectId);
  deleteProject(projectId);

  res.json({ success: true, message: "项目及视频已删除" });
});

app.get("/api/search", (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) {
    res.json({ projects: [], relatedProjects: [] });
    return;
  }
  res.json(searchApprovedProjects(q));
});

app.post("/api/register", (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const displayName = String(req.body.display_name || "").trim();
    const password = String(req.body.password || "");
    const email = String(req.body.email || "").trim().toLowerCase();

    if (!username || username.length < 3) {
      return res.status(400).json({ success: false, message: "账号至少3个字符" });
    }
    if (!displayName) {
      return res.status(400).json({ success: false, message: "昵称不能为空" });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: "密码至少6位" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "请填写正确的邮箱地址（用于找回密码）" });
    }

    const existing = getUserByUsername(username);
    if (existing) {
      return res.status(409).json({ success: false, message: "该账号已被注册" });
    }
    const emailOwner = getUserByEmail(email);
    if (emailOwner) {
      return res.status(409).json({ success: false, message: "该邮箱已被其他账号绑定" });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    createUser({ username, display_name: displayName, password_hash: passwordHash, email });

    res.json({ success: true, message: "注册成功，请登录" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || "注册失败" });
  }
});

app.post("/api/login", (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    if (!username || !password) {
      return res.status(400).json({ success: false, message: "账号和密码不能为空" });
    }

    const user = getUserByUsernameOrEmail(username);
    if (!user) {
      return res.status(401).json({ success: false, message: "账号或密码不正确" });
    }

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, message: "账号或密码不正确" });
    }

    const sessionToken = createUserSession(user.username);
    res.json({
      success: true,
      user: {
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        email: user.email || "",
        sessionToken
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || "登录失败" });
  }
});

// ===== 忘记密码：第一步，发验证码 =====
app.post("/api/password-reset/request", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    if (!username) {
      return res.status(400).json({ success: false, message: "请输入账号或邮箱" });
    }

    const user = getUserByUsernameOrEmail(username);
    if (!user) {
      return res.status(404).json({ success: false, message: "该账号不存在" });
    }
    if (!user.email) {
      return res.status(400).json({ success: false, message: "该账号尚未绑定邮箱，请联系管理员重置密码" });
    }

    checkSendCooldown(user.username, "reset");

    // 数据库级限流兜底（防止服务重启导致内存限流丢失）
    const lastSentAt = getLastResetCodeSentAt({ username: user.username, purpose: "reset" });
    if (lastSentAt) {
      const elapsed = Date.now() - new Date(lastSentAt.replace(" ", "T")).getTime();
      if (elapsed >= 0 && elapsed < CODE_SEND_INTERVAL_MS) {
        const waitSeconds = Math.ceil((CODE_SEND_INTERVAL_MS - elapsed) / 1000);
        return res.status(429).json({ success: false, message: `发送太频繁，请 ${waitSeconds} 秒后再试` });
      }
    }

    const code = generateCode();
    insertResetCode({ username: user.username, email: user.email, code, purpose: "reset" });
    await sendCodeEmail(user.email, code, "重置密码");
    markCodeSent(user.username, "reset");

    const masked = user.email.replace(/^(.).*(@.*)$/, "$1****$2");
    res.json({ success: true, message: `验证码已发送至 ${masked}，请查收` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || "发送失败，请稍后重试" });
  }
});

// ===== 忘记密码：第二步，验证码 + 新密码 =====
app.post("/api/password-reset/confirm", (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const code = String(req.body.code || "").trim();
    const password = String(req.body.password || "");

    if (!username || !code) {
      return res.status(400).json({ success: false, message: "请输入账号和验证码" });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: "新密码至少6位" });
    }

    const user = getUserByUsernameOrEmail(username);
    if (!user) {
      return res.status(404).json({ success: false, message: "该账号不存在" });
    }

    const record = findValidResetCode({ username: user.username, code, purpose: "reset" });
    if (!record) {
      return res.status(400).json({ success: false, message: "验证码错误或已过期" });
    }

    updateUserPassword(user.username, bcrypt.hashSync(password, 10));
    markResetCodeUsed(record.id);

    res.json({ success: true, message: "密码已重置，请使用新密码登录" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || "重置失败" });
  }
});

// ===== 绑定/换绑邮箱：第一步，验证密码并发验证码 =====
app.post("/api/account/email/code", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    const email = String(req.body.email || "").trim().toLowerCase();

    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "请填写正确的邮箱地址" });
    }

    const user = getUserByUsername(username);
    if (!user) {
      return res.status(404).json({ success: false, message: "账号不存在" });
    }
    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ success: false, message: "密码不正确" });
    }

    const emailOwner = getUserByEmail(email);
    if (emailOwner && emailOwner.username !== user.username) {
      return res.status(409).json({ success: false, message: "该邮箱已被其他账号绑定" });
    }

    checkSendCooldown(user.username, "bind");

    const code = generateCode();
    insertResetCode({ username: user.username, email, code, purpose: "bind" });
    await sendCodeEmail(email, code, "绑定邮箱");
    markCodeSent(user.username, "bind");

    res.json({ success: true, message: `验证码已发送至 ${email}，请查收` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || "发送失败，请稍后重试" });
  }
});

// ===== 绑定/换绑邮箱：第二步，验证码确认 =====
app.post("/api/account/email", (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    const email = String(req.body.email || "").trim().toLowerCase();
    const code = String(req.body.code || "").trim();

    if (!isValidEmail(email) || !code) {
      return res.status(400).json({ success: false, message: "请填写邮箱和验证码" });
    }

    const user = getUserByUsername(username);
    if (!user) {
      return res.status(404).json({ success: false, message: "账号不存在" });
    }
    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ success: false, message: "密码不正确" });
    }

    const record = findValidResetCode({ username: user.username, code, purpose: "bind" });
    if (!record || record.email !== email) {
      return res.status(400).json({ success: false, message: "验证码错误或已过期" });
    }

    updateUserEmail(user.username, email);
    markResetCodeUsed(record.id);

    res.json({ success: true, message: "邮箱绑定成功" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || "绑定失败" });
  }
});

app.delete("/api/account", (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    if (!username || !password) {
      return res.status(400).json({ success: false, message: "账号和密码不能为空" });
    }

    const user = getUserByUsername(username);
    if (!user) {
      return res.status(404).json({ success: false, message: "账号不存在" });
    }

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, message: "密码不正确" });
    }

    deleteUserAndProjects(username);
    res.json({ success: true, message: "账号及所有数据已永久删除" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || "注销失败" });
  }
});

app.listen(port, () => {
  console.log(`Fixone MVP server running at http://localhost:${port}`);
});
