const { app } = require("./app");

const port = Number(process.env.PORT || 3000);

app.listen(port, () => {
  console.log(`FixOne配件库 已启动：http://localhost:${port}`);
});
