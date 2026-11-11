import { getUserByUsername, updateUserRole } from "./db.js";

const username = String(process.argv[2] || "").trim();

if (!username) {
  console.error("Usage: npm run grant:admin -- <username>");
  process.exit(1);
}

if (!getUserByUsername(username)) {
  console.error(`User not found: ${username}`);
  process.exit(1);
}

updateUserRole(username, "admin");
console.log(`Administrator role granted to: ${username}`);
