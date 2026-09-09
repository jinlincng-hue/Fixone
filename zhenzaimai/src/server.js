const { app } = require("./app");

const port = Number(process.env.PORT || 3000);

app.listen(port, () => {
  console.log(`高桥 · 镇在卖 已启动：http://localhost:${port}`);
});
