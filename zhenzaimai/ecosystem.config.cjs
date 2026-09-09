module.exports = {
  apps: [
    {
      name: "gaoqiao-zhenzaimai",
      script: "src/server.js",
      interpreter: "/home/acmorning/node-v22.14.0-linux-x64/bin/node",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        DB_PATH: "data/gaoqiao.sqlite"
      }
    }
  ]
};
