const bcrypt = require("bcryptjs");
const { createUser, getUserByUsername } = require("./server/db.js");

var users = [
  { u: "fixzengjinling", d: "曾锦玲", p: "zengjinling01" },
  { u: "fixwangqi", d: "王琦", p: "wangqi01" },
  { u: "fixyanshuting", d: "闫淑婷", p: "yanshuting01" },
  { u: "fixzhanrui", d: "湛瑞", p: "zhanrui01" },
  { u: "fixyangshuangshuang", d: "杨双双", p: "yangshuangshuang01" }
];

users.forEach(function(u) {
  var ex = getUserByUsername(u.u);
  if (!ex) {
    createUser({ username: u.u, display_name: u.d, password_hash: bcrypt.hashSync(u.p, 10) });
    console.log("Created: " + u.u);
  } else {
    console.log("Exists: " + u.u);
  }
});
console.log("Done");