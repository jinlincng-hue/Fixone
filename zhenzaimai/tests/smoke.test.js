const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const request = require("supertest");

const root = path.resolve(__dirname, "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gaoqiao-mvp-"));
const dbPath = path.join(tempDir, "test.sqlite");

process.env.NODE_ENV = "test";
process.env.DB_PATH = dbPath;
process.env.SESSION_SECRET = "test-session-secret-please-replace-in-production";
process.env.WECHAT_DEV_LOGIN = "true";

const init = spawnSync(process.execPath, ["scripts/init-db.js", "--reset"], {
  cwd: root,
  env: { ...process.env, DB_PATH: dbPath },
  encoding: "utf8"
});

assert.equal(init.status, 0, init.stderr || init.stdout);

const { app, db } = require("../src/app");
const { closeDb } = require("../src/db");
const imagePng = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0000004010100c928f8b60000000049454e44ae426082", "hex");

after(() => {
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("公开页面可以打开", async () => {
  const home = await request(app).get("/").expect(200).expect(/今日好物/);
  assert.ok(home.text.includes('class="bottom-nav"'));
  assert.ok(home.text.includes('class="top-search"'));
  assert.ok(home.text.includes(">购物<"));
  assert.ok(home.text.includes(">逛店<"));
  assert.equal(home.text.includes("home-categories"), false);
  const categoryIconUrls = [...home.text.matchAll(/src="(\/assets\/images\/category-icons\/[^\"]+\.svg)"/g)].map((match) => match[1]);
  assert.equal(categoryIconUrls.length, 0);
  await request(app).get("/shops").expect(200).expect(/附近好店/);
  await request(app).get("/products").expect(200).expect(/附近商品/);
  await request(app).get("/services").expect(200).expect(/暂时还没有已核验商家发布便民服务/);
  await request(app).get("/wanted").expect(200).expect(/还没有求购信息/);
  await request(app).get("/map").expect(200).expect(/高桥镇地图/);
});

test("搜索和分类筛选返回正确结果", async () => {
  await request(app).get("/search").query({ q: "电钻" }).expect(200).expect(/暂时没有搜到/);
  await request(app).get("/categories/hardware").expect(200).expect(/五金农具/);
});

test("普通用户可以注册、登录并发布闲置和求购", async () => {
  const agent = request.agent(app);
  await agent
    .post("/register")
    .type("form")
    .send({
      role: "user",
      username: "smoke_user",
      phone: "13900000001",
      village: "测试村",
      password: "Smoke12345!",
      next: "/"
    })
    .expect(302);

  await agent
    .post("/login")
    .type("form")
    .send({ username: "smoke_user", password: "Smoke12345!", next: "/account" })
    .expect(302);
  await agent.get("/messages").expect(200).expect(/data-auto-close-flash/);
  await agent.get("/account/profile").expect(200);
  await agent.get("/account/security").expect(200);
  await agent.get("/account/security/password").expect(200);
  await agent.get("/account/security/delete").expect(200);
  await agent.get("/account/settings").expect(200);
  await agent.get("/account/shops").expect(200);
  await agent.get("/account/listings").expect(200);
  await agent.get("/account/wanted").expect(200);
  await agent.get("/account").expect(200).expect(/我的发布/).expect(/常用服务/);

  await agent.post("/account/switch").expect(302).expect("Location", /\/auth\?switched=1/);
  await agent.get("/account").expect(302);
  await agent
    .post("/login")
    .type("form")
    .send({ username: "smoke_user", password: "Smoke12345!", next: "/account" })
    .expect(302);

  await agent
    .post("/account/profile")
    .type("form")
    .send({ username: "smoke_user_new", phone: "13900000009", village: "测试新村" })
    .expect(302);

  await agent.get("/account").expect(200).expect(/smoke_user_new/).expect(/测试新村/);

  await agent
    .post("/account/password")
    .type("form")
    .send({ current_password: "Smoke12345!", new_password: "Smoke54321!", confirm_password: "Smoke54321!" })
    .expect(302);

  await agent.post("/logout").type("form").expect(302);
  await agent.post("/login").type("form").send({ username: "smoke_user_new", password: "Smoke54321!", next: "/account" }).expect(302);
  await agent.get("/account").expect(200).expect(/smoke_user_new/);

  await agent
    .get("/publish")
    .expect(200)
    .expect(/我要卖出去/)
    .expect(/我要买进来/)
    .expect(/name="images"/)
    .expect(/name="name"/)
    .expect(/name="description"/)
    .expect((response) => {
      assert.ok(response.text.includes('class="bottom-nav"'));
      assert.equal(response.text.includes('class="top-search"'), false);
      assert.ok(response.text.includes("publish-hero-copy"));
      assert.ok(response.text.includes('name="price"'));
      assert.equal(response.text.includes('name="unit"'), false);
      assert.equal(response.text.includes('name="category_id"'), false);
      assert.equal(response.text.includes('name="stock_status"'), false);
      assert.equal(response.text.includes('name="condition"'), false);
      assert.equal(response.text.includes('name="village"'), false);
      assert.equal(response.text.includes('name="contact_phone"'), false);
    });

  await agent
    .post("/publish")
    .field("publish_intent", "sell")
    .field("name", "超价测试")
    .field("price", "1000000.00")
    .field("description", "应该被价格校验拦截。")
    .expect(400)
    .expect(/价格需在0.00到999999.00之间/);

  await agent
    .post("/publish")
    .field("publish_intent", "sell")
    .field("name", "简化发布测试")
    .field("price", "12.50")
    .field("description", "只保留名称、图片和描述。")
    .attach("images", imagePng, { filename: "simple-sell.png", contentType: "image/png" })
    .expect(302);
  const simpleListing = db.prepare("SELECT * FROM personal_listings WHERE name = ?").get("简化发布测试");
  assert.equal(simpleListing.listing_type, "product");
  assert.equal(simpleListing.price, 12.5);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM listing_images WHERE listing_id = ?").get(simpleListing.id).count, 1);
  await agent
    .get(`/listings/${simpleListing.id}`)
    .expect(200)
    .expect(/product-intro-line/)
    .expect(/comment-section/)
    .expect((response) => {
      assert.equal(response.text.includes(`/listings/${simpleListing.id}/edit`), false);
      assert.equal(response.text.includes(`/contact/listing/${simpleListing.id}`), true);
    });
  const buyer = request.agent(app);
  await buyer
    .post("/register")
    .type("form")
    .send({
      role: "user",
      username: "message_buyer",
      phone: "",
      village: "测试村",
      password: "Buyer12345!",
      next: "/"
    })
    .expect(302);
  await buyer.post("/login").type("form").send({ username: "message_buyer", password: "Buyer12345!", next: "/" }).expect(302);
  const contact = await buyer.get(`/contact/listing/${simpleListing.id}`).expect(302);
  assert.match(contact.headers.location, /^\/messages\/\d+$/);
  const threadId = Number(contact.headers.location.split("/").pop());
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM message_threads WHERE id = ?").get(threadId).count, 1);
  await buyer
    .get("/messages")
    .expect(200)
    .expect(/chat-shell list-only/)
    .expect(/我咨询的商品/)
    .expect(/卖家：/)
    .expect(/message-system-details/)
    .expect((response) => {
      assert.equal(response.text.includes("<strong>简化发布测试</strong>"), true);
      assert.equal(response.text.includes("chat-compose"), false);
    });
  await buyer.get(`/messages/${threadId}`).expect(200).expect(/chat-compose/).expect(/我想咨询/).expect(/简化发布测试/);
  await buyer.post(`/messages/${threadId}`).type("form").send({ content: "这个还能自提吗？" }).expect(302);
  await agent
    .get("/messages")
    .expect(200)
    .expect(/chat-shell list-only/)
    .expect(/我的商品咨询/)
    .expect(/简化发布测试/)
    .expect((response) => assert.equal(response.text.includes("chat-compose"), false));
  await agent
    .get("/messages")
    .expect(200)
    .expect((response) => assert.equal(response.text.includes("message_buyer"), false));
  await agent
    .get(`/messages/item/listing/${simpleListing.id}`)
    .expect(200)
    .expect(/客户列表/)
    .expect(/message_buyer/)
    .expect((response) => assert.equal(response.text.includes("chat-compose"), false));
  await agent.get(`/messages/${threadId}`).expect(200).expect(/chat-bubble-row /).expect(/message_buyer/).expect(/chat-compose/);
  await agent.post(`/messages/${threadId}`).type("form").send({ content: "可以，今天晚上方便。" }).expect(302);
  await buyer
    .get(`/messages/${threadId}`)
    .expect(200)
    .expect(/可以，今天晚上方便。/)
    .expect(/chat-message-avatar/)
    .expect(/chat-time-separator/)
    .expect(/chat-bubble-row mine/)
    .expect((response) => {
      assert.equal(response.text.includes("chat-bubble-name"), false);
      assert.equal(response.text.includes("message-system-details"), false);
    });
  await agent
    .post("/comments")
    .type("form")
    .send({ target_type: "listing", target_id: simpleListing.id, content: "smoke public comment" })
    .expect(302)
    .expect("Location", `/listings/${simpleListing.id}#comments`);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM item_comments WHERE target_type = 'listing' AND target_id = ?").get(simpleListing.id).count, 1);
  const ownComment = db.prepare("SELECT * FROM item_comments WHERE target_type = 'listing' AND target_id = ?").get(simpleListing.id);
  await agent
    .get(`/listings/${simpleListing.id}`)
    .expect(200)
    .expect(/smoke public comment/)
    .expect(new RegExp(`/comments/${ownComment.id}/delete`));
  const otherUser = request.agent(app);
  await otherUser.post("/login").type("form").send({ username: "admin", password: "Admin12345!", next: "/" }).expect(302);
  await otherUser.post(`/comments/${ownComment.id}/delete`).expect(403);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM item_comments WHERE id = ?").get(ownComment.id).count, 1);
  await agent.post(`/comments/${ownComment.id}/delete`).expect(302).expect("Location", `/listings/${simpleListing.id}#comments`);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM item_comments WHERE id = ?").get(ownComment.id).count, 0);
  await agent
    .post("/comments")
    .type("form")
    .send({ target_type: "listing", target_id: simpleListing.id, content: "delete with listing" })
    .expect(302);
  await request(app).get("/").expect(200).expect(/简化发布测试/);

  await agent
    .post("/publish")
    .field("publish_intent", "buy")
    .field("name", "简化求购测试")
    .field("price", "99.00")
    .field("description", "只保留名称、图片和描述的求购。")
    .attach("images", imagePng, { filename: "simple-buy.png", contentType: "image/png" })
    .expect(302);
  const simpleWanted = db.prepare("SELECT * FROM wanted_posts WHERE title = ?").get("简化求购测试");
  assert.equal(simpleWanted.description, "只保留名称、图片和描述的求购。");
  assert.ok(simpleWanted.image);

  const simpleImageFile = path.join(root, "public", simpleListing.image.slice(1));
  await agent.post(`/listings/${simpleListing.id}/delete`).expect(302).expect("Location", "/account/listings");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM personal_listings WHERE id = ?").get(simpleListing.id).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM item_comments WHERE target_type = 'listing' AND target_id = ?").get(simpleListing.id).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM message_threads WHERE target_type = 'listing' AND target_id = ?").get(simpleListing.id).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM direct_messages WHERE thread_id = ?").get(threadId).count, 0);
  assert.equal(fs.existsSync(simpleImageFile), false);

  await agent
    .post("/publish")
    .type("form")
    .send({
      kind: "listing",
      type: "secondhand",
      category_id: 7,
      name: "烟雾测试二手自行车",
      price: "120",
      unit: "辆",
      spec: "成人款",
      description: "自动化测试发布的闲置信息。",
      stock_status: "待售",
      condition: "八成新",
      village: "测试村",
      contact_phone: "13900000001",
      pickup: "on",
      delivery_area: "自提"
    })
    .expect(302);

  await agent.get("/secondhand").expect(200).expect(/烟雾测试二手自行车/);

  await agent
    .post("/wanted")
    .type("form")
    .send({
      title: "烟雾测试求购水泵",
      budget: "200 元以内",
      village: "测试村",
      needs_delivery: "on",
      contact_phone: "13900000001"
    })
    .expect(302);

  await agent.get("/wanted").expect(200).expect(/烟雾测试求购水泵/);

  await agent
    .post("/account/delete")
    .type("form")
    .send({ password: "wrong-password", confirm_text: "注销账号" })
    .expect(302);

  await agent.get("/account").expect(200).expect(/smoke_user_new/);

  await agent
    .post("/account/delete")
    .type("form")
    .send({ password: "Smoke54321!", confirm_text: "注销账号" })
    .expect(302);

  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM users WHERE username = ?").get("smoke_user_new").count, 0);
  await agent.get("/account").expect(302);
  await request(app).get("/secondhand").expect(200).expect((res) => assert.equal(res.text.includes("烟雾测试二手自行车"), false));
  await request(app).get("/wanted").expect(200).expect((res) => assert.equal(res.text.includes("烟雾测试求购水泵"), false));
  await request(app).post("/login").type("form").send({ username: "smoke_user_new", password: "Smoke54321!", next: "/" }).expect(401);
});

test("商家可以申请入驻，管理员审核后商家可以发布商品", async () => {
  const merchant = request.agent(app);
  await merchant
    .post("/register")
    .type("form")
    .send({
      role: "merchant",
      username: "smoke_merchant",
      phone: "13900000002",
      village: "测试村",
      password: "Merchant12345!",
      next: "/merchant/apply"
    })
    .expect(302);

  await merchant
    .post("/login")
    .type("form")
    .send({ username: "smoke_merchant", password: "Merchant12345!", next: "/merchant/legacy-apply" })
    .expect(302);
  await merchant
    .post("/merchant/legacy-apply")
    .field("shop_name", "烟雾测试小店")
    .field("credit_code", "91430100SMOKE001")
    .field("address", "测试村 1 号")
    .field("phone", "13900000002")
    .field("business_hours", "08:00-20:00")
    .field("business_scope", "日用百货")
    .field("delivery_area", "测试村")
    .attach("license", Buffer.from("fake image bytes"), { filename: "license.png", contentType: "image/png" })
    .expect(302);

  const appRow = db.prepare("SELECT id FROM merchant_applications WHERE shop_name = ?").get("烟雾测试小店");
  assert.ok(appRow?.id);

  const admin = request.agent(app);
  await admin
    .post("/login")
    .type("form")
    .send({ username: "admin", password: "Admin12345!", next: "/admin/dashboard" })
    .expect(302);

  await admin
    .post(`/admin/applications/${appRow.id}/review`)
    .type("form")
    .send({ action: "approve", review_note: "测试通过" })
    .expect(302);

  await request(app).get("/shops").expect(200).expect(/烟雾测试小店/);

  await merchant
    .post("/merchant/products")
    .type("form")
    .send({
      category_id: 2,
      name: "烟雾测试电池",
      price: "9.90",
      unit: "节",
      spec: "5号",
      description: "自动化测试商品。",
      stock_status: "有货",
      village: "测试村",
      contact_phone: "13900000002",
      pickup: "on",
      delivery: "on",
      delivery_area: "测试村"
    })
    .expect(302);
  const directProduct = db.prepare("SELECT p.*, s.business_mode, s.review_status, s.verified, s.application_id FROM products p JOIN shops s ON s.id = p.shop_id WHERE p.name = ?").get("烟雾测试电池");
  assert.equal(directProduct.publication_status, "published");
  assert.equal(directProduct.status, "active");

  await merchant
    .post("/merchant/services")
    .type("form")
    .send({
      type: "送水到家",
      title: "烟雾测试送水",
      description: "自动化测试发布的便民服务。",
      phone: "13900000002",
      business_hours: "08:00-20:00",
      delivery_area: "测试村",
      village: "测试村"
    })
    .expect(302);

  await request(app).get("/search").query({ q: "烟雾测试电池" }).expect(200).expect(/烟雾测试电池/);
  await request(app).get("/categories/daily").expect(200).expect(/烟雾测试电池/);
  await request(app).get("/services").expect(200).expect(/烟雾测试送水/);

  await merchant
    .post("/merchant/products")
    .field("shop_id", String(directProduct.shop_id))
    .field("category_id", "2")
    .field("name", "待彻底删除商品")
    .field("price", "18.80")
    .field("unit", "件")
    .field("description", "验证删除商品时不留下图片、评论、举报和正文。")
    .field("stock_status", "有货")
    .attach("images", imagePng, { filename: "delete-product-1.png", contentType: "image/png" })
    .attach("images", imagePng, { filename: "delete-product-2.png", contentType: "image/png" })
    .expect(302);
  const deletedProduct = db.prepare("SELECT * FROM products WHERE name = ?").get("待彻底删除商品");
  const deletedProductImages = db.prepare("SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order").all(deletedProduct.id);
  const deletedProductFiles = deletedProductImages.map((image) => path.join(root, "public", image.image_path.slice(1)));
  assert.equal(deletedProductImages.length, 2);
  deletedProductFiles.forEach((file) => assert.equal(fs.existsSync(file), true));
  await merchant.post("/comments").type("form").send({ target_type: "product", target_id: deletedProduct.id, content: "随商品删除的评论" }).expect(302);
  await merchant.post("/reports").type("form").send({ target_type: "product", target_id: deletedProduct.id, reason: "删除清理测试" }).expect(302);
  await merchant.post(`/merchant/products/${deletedProduct.id}/delete`).expect(302);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM products WHERE id = ?").get(deletedProduct.id).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM product_images WHERE product_id = ?").get(deletedProduct.id).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM item_comments WHERE target_type = 'product' AND target_id = ?").get(deletedProduct.id).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM reports WHERE target_type = 'product' AND target_id = ?").get(deletedProduct.id).count, 0);
  deletedProductFiles.forEach((file) => assert.equal(fs.existsSync(file), false));
});

test("微信测试登录可无手机号完成店铺草稿、审核和认领流程", async () => {
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0000004010100c928f8b60000000049454e44ae426082", "hex");
  const merchant = request.agent(app);

  await request(app).get("/auth/wechat").expect(302).expect("Location", /\/auth/);
  await merchant.post("/auth/wechat/dev").type("form").send({ openid: "wizard_owner", next: "/merchant/apply" }).expect(302);
  await merchant.get("/merchant/apply").expect(200).expect(/我要开店/);

  const create = await merchant.post("/merchant/onboarding/create").expect(302);
  const shopId = Number(create.headers.location.match(/onboarding\/(\d+)\/type/)[1]);
  const owner = db.prepare("SELECT * FROM users WHERE wechat_openid = ?").get("dev_wizard_owner");
  await merchant.get(`/merchant/onboarding/${shopId}/type`).expect(200).expect(/你想怎么卖/).expect(/我家有实体店/).expect(/我想开个自家小铺/);
  await merchant.post(`/merchant/onboarding/${shopId}/type`).type("form").send({ business_mode: "verified_store" }).expect(302);
  await merchant
    .post(`/merchant/onboarding/${shopId}/autosave`)
    .send({ step: "basic", name: "autosaved shop", village: "test village", town: "Gaoqiao", primary_category_id: "3", business_state: "open" })
    .expect(200)
    .expect((response) => assert.equal(response.body.saved, true));
  assert.equal(db.prepare("SELECT name FROM shops WHERE id = ?").get(shopId).name, "autosaved shop");
  assert.equal(owner.phone, "");
  await merchant.get(`/merchant/onboarding/${shopId}/basic`).expect(200).expect(/第 2 步，共 8 步/);

  await merchant
    .post(`/merchant/onboarding/${shopId}/basic`)
    .type("form")
    .send({
      action: "next",
      name: "微信测试实体店",
      primary_category_id: "3",
      village: "测试村",
      town: "高桥镇",
      business_state: "open",
      description: "测试店铺简介"
    })
    .expect(302);
  await merchant.get(`/merchant/onboarding/${shopId}/photos`).expect(200).expect(/门面封面/);

  await merchant
    .post(`/merchant/onboarding/${shopId}/photos`)
    .field("action", "save")
    .attach("cover", Buffer.from("not a png"), { filename: "cover.png", contentType: "image/png" })
    .expect(200)
    .expect(/图片内容与文件扩展名不匹配/);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM shop_media WHERE shop_id = ?").get(shopId).count, 0);

  await merchant
    .post(`/merchant/onboarding/${shopId}/photos`)
    .field("action", "next")
    .attach("cover", png, { filename: "cover.png", contentType: "image/png" })
    .attach("interior", png, { filename: "inside-1.png", contentType: "image/png" })
    .attach("interior", png, { filename: "inside-2.png", contentType: "image/png" })
    .expect(302)
    .expect("Location", new RegExp(`/merchant/onboarding/${shopId}/location`));
  await merchant.get(`/merchant/onboarding/${shopId}/location`).expect(200).expect(/地图位置/);

  await merchant
    .post(`/merchant/onboarding/${shopId}/location`)
    .type("form")
    .send({ action: "next", province: "湖南省", city: "长沙市", district: "长沙县", town: "高桥镇", village: "测试村", address_detail: "老街 9 号", latitude: "28.463", longitude: "113.331" })
    .expect(302);
  await merchant.get(`/merchant/onboarding/${shopId}/contact`).expect(200).expect(/联系方式/);
  await merchant
    .post(`/merchant/onboarding/${shopId}/contact`)
    .type("form")
    .send({ action: "next", preferred_contact: "consultation", allow_consultation: "on", business_state: "open", opening_time: "08:00", closing_time: "20:00", weekly_schedule: ["一", "二"] })
    .expect(302);
  await merchant.get(`/merchant/onboarding/${shopId}/services`).expect(200).expect(/服务能力/);
  await merchant.post(`/merchant/onboarding/${shopId}/services`).type("form").send({ action: "next", service_tags: ["到店购买", "配送到村"], delivery_area: "测试村" }).expect(302);
  await merchant.get(`/merchant/onboarding/${shopId}/qualification`).expect(200).expect(/资质认证/);
  await merchant
    .post(`/merchant/onboarding/${shopId}/qualification`)
    .field("action", "next")
    .field("applicant_relation", "店主")
    .attach("license", png, { filename: "business-license.png", contentType: "image/png" })
    .expect(302);
  await merchant.get(`/merchant/onboarding/${shopId}/preview`).expect(200).expect(/顾客看到的页面/);
  await merchant.post(`/merchant/onboarding/${shopId}/submit`).expect(302);
  assert.equal(db.prepare("SELECT review_status FROM shops WHERE id = ?").get(shopId).review_status, "pending");

  const admin = request.agent(app);
  await admin.post("/login").type("form").send({ username: "admin", password: "Admin12345!", next: "/admin/shop-reviews" }).expect(302);
  await admin.get("/admin/shop-reviews").expect(200).expect(/微信测试实体店/);
  await admin
    .post(`/admin/shops/${shopId}/review`)
    .type("form")
    .send({ action: "changes", review_note: "请补充门面招牌说明", review_fields: "photos" })
    .expect(302);
  assert.equal(db.prepare("SELECT review_status FROM shops WHERE id = ?").get(shopId).review_status, "changes_requested");
  await merchant.get(`/merchant/onboarding/${shopId}/photos`).expect(200).expect(/请补充门面招牌说明/);
  await merchant.post(`/merchant/onboarding/${shopId}/submit`).expect(302);
  await admin.post(`/admin/shops/${shopId}/review`).type("form").send({ action: "approve", review_note: "资料完整" }).expect(302);
  assert.equal(db.prepare("SELECT review_status FROM shops WHERE id = ?").get(shopId).review_status, "approved");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM shop_members WHERE shop_id = ? AND user_id = ? AND role = 'owner' AND status = 'active'").get(shopId, owner.id).count, 1);
  await merchant
    .get("/merchant/dashboard")
    .expect(200)
    .expect(/微信测试实体店/)
    .expect(/aria-label="返回我的店铺"/)
    .expect(/merchant-mobile-shortcuts/);
  await merchant.post("/merchant/onboarding/create").expect(302).expect("Location", "/account/shops");
  await merchant.get("/account/shops").expect(200).expect(/我的店铺/);
  await merchant
    .post("/merchant/products")
    .type("form")
    .send({ shop_id: shopId, category_id: "2", name: "collaborator test product", price: "8.8", unit: "item", description: "product status collaboration test" })
    .expect(302);
  const collaborationProduct = db.prepare("SELECT * FROM products WHERE name = ?").get("collaborator test product");
  assert.equal(collaborationProduct.shop_id, shopId);

  await merchant
    .post("/merchant/products")
    .type("form")
    .send({ shop_id: shopId, category_id: "8", name: "敏感分类审核测试", price: "10", unit: "件", description: "用于验证敏感分类必须进入人工审核。" })
    .expect(302);
  const sensitiveProduct = db.prepare("SELECT publication_status, status FROM products WHERE name = ?").get("敏感分类审核测试");
  assert.equal(sensitiveProduct.publication_status, "pending");
  assert.equal(sensitiveProduct.status, "inactive");
  const sensitiveProductId = db.prepare("SELECT id FROM products WHERE name = ?").get("敏感分类审核测试").id;
  await merchant.post(`/merchant/products/${sensitiveProductId}/status`).type("form").send({ status: "active" }).expect(302);
  assert.equal(db.prepare("SELECT status FROM products WHERE id = ?").get(sensitiveProductId).status, "inactive");

  const collaborator = request.agent(app);
  await collaborator.post("/auth/wechat/dev").type("form").send({ openid: "inventory_helper", next: "/" }).expect(302);
  const helper = db.prepare("SELECT * FROM users WHERE wechat_openid = ?").get("dev_inventory_helper");
  await merchant
    .post(`/merchant/shops/${shopId}/collaborators`)
    .type("form")
    .send({ username: helper.username })
    .expect(302);
  assert.equal(db.prepare("SELECT role FROM shop_members WHERE shop_id = ? AND user_id = ? AND status = 'active'").get(shopId, helper.id).role, "clerk");
  await collaborator.get(`/merchant/dashboard?shop=${shopId}`).expect(200).expect(/商品状态/);
  await collaborator.post(`/merchant/products/${collaborationProduct.id}/status`).type("form").send({ status: "inactive" }).expect(302);
  await collaborator.post(`/merchant/products/${collaborationProduct.id}/stock-status`).type("form").send({ stock_status: "out of stock" }).expect(302);
  const collaborationStatus = db.prepare("SELECT status, stock_status FROM products WHERE id = ?").get(collaborationProduct.id);
  assert.equal(collaborationStatus.status, "inactive");
  assert.equal(collaborationStatus.stock_status, "out of stock");
  await collaborator.get(`/merchant/products/${collaborationProduct.id}/edit`).expect(404);
  await collaborator
    .post("/merchant/products")
    .type("form")
    .send({ shop_id: shopId, category_id: "2", name: "clerk cannot publish", price: "1", unit: "item", description: "must be forbidden" })
    .expect(403);
  await collaborator.post(`/merchant/shops/${shopId}/business-state`).type("form").send({ business_state: "rest" }).expect(403);
  await collaborator.post(`/merchant/shops/${shopId}/collaborators`).type("form").send({ username: owner.username }).expect(403);
  await merchant
    .post("/merchant/products")
    .type("form")
    .send({ shop_id: "999999", category_id: "2", name: "unauthorized product", price: "8.8", unit: "item", description: "must not be published" })
    .expect(403);

  const claimant = request.agent(app);
  await claimant.post("/auth/wechat/dev").type("form").send({ openid: "claimant", next: "/merchant/claim" }).expect(302);
  await claimant
    .post("/merchant/claims")
    .field("shop_id", String(shopId))
    .field("relationship", "共同经营者")
    .field("invite_code", "INVITE-TEST")
    .attach("license", png, { filename: "claim-license.png", contentType: "image/png" })
    .expect(302);
  const claim = db.prepare("SELECT * FROM shop_claim_applications WHERE shop_id = ? AND relationship = ?").get(shopId, "共同经营者");
  assert.equal(claim.status, "pending");
  await claimant.post(`/merchant/shops/${shopId}/business-state`).type("form").send({ business_state: "rest" }).expect(403);
  await admin.post(`/admin/shop-claims/${claim.id}/review`).type("form").send({ action: "approve", review_note: "已核验共同经营关系" }).expect(302);
  const claimCredential = db.prepare("SELECT * FROM shop_credentials WHERE shop_id = ? AND credential_type = 'claim_business_license'").get(shopId);
  assert.ok(claimCredential?.id);
  await claimant.get(`/merchant/onboarding/${shopId}/credentials/${claimCredential.id}`).expect(200);
  const outsider = request.agent(app);
  await outsider.post("/auth/wechat/dev").type("form").send({ openid: "credential_outsider", next: "/" }).expect(302);
  await outsider.get(`/merchant/onboarding/${shopId}/credentials/${claimCredential.id}`).expect(404);
  await claimant.get("/merchant/dashboard").expect(200).expect(/微信测试实体店/);
  await claimant.post("/merchant/onboarding/create").expect(302).expect("Location", "/account/shops");
});

test("乡邻小铺无需执照即可创建，所有发布进入审核队列", async () => {
  const neighbour = request.agent(app);
  await neighbour.post("/auth/wechat/dev").type("form").send({ openid: "home_shop_owner", next: "/merchant/apply" }).expect(302);
  const create = await neighbour.post("/merchant/onboarding/create").expect(302);
  const shopId = Number(create.headers.location.match(/onboarding\/(\d+)\/type/)[1]);

  await neighbour.post(`/merchant/onboarding/${shopId}/type`).type("form").send({ business_mode: "home_shop" }).expect(302);
  await neighbour
    .get(`/merchant/onboarding/${shopId}/basic`)
    .expect(200)
    .expect(/乡邻小铺资料/)
    .expect((response) => {
      assert.equal(response.text.includes('name="license"'), false);
      assert.equal(response.text.includes('name="primary_category_id"'), false);
      assert.equal(response.text.includes("开业年份"), false);
    });
  await neighbour
    .post(`/merchant/onboarding/${shopId}/basic`)
    .type("form")
    .send({ action: "next", name: "", town: "高桥镇", village: "青河村", description: "自家蔬菜和闲置物品" })
    .expect(302)
    .expect("Location", new RegExp(`/merchant/onboarding/${shopId}/photos`));
  await neighbour.post(`/merchant/onboarding/${shopId}/photos`).type("form").send({ action: "next" }).expect(302).expect("Location", new RegExp(`/merchant/onboarding/${shopId}/contact`));
  await neighbour
    .post(`/merchant/onboarding/${shopId}/contact`)
    .type("form")
    .send({ action: "next", phone: "13900000088", preferred_contact: "phone", public_phone: "on", pickup_location: "青河村村口小卖部旁" })
    .expect(302)
    .expect("Location", new RegExp(`/merchant/onboarding/${shopId}/preview`));
  await neighbour.get(`/merchant/onboarding/${shopId}/preview`).expect(200).expect(/具体位置请联系卖家/);
  await neighbour.post(`/merchant/onboarding/${shopId}/submit`).expect(302);

  const shop = db.prepare("SELECT * FROM shops WHERE id = ?").get(shopId);
  const owner = db.prepare("SELECT * FROM users WHERE wechat_openid = ?").get("dev_home_shop_owner");
  assert.equal(shop.business_mode, "home_shop");
  assert.equal(shop.review_status, "approved");
  assert.equal(shop.verified, 0);
  assert.equal(shop.name, "本地微信测试用户的青河村乡邻小铺");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM store_members WHERE store_id = ? AND user_id = ? AND role = 'owner' AND status = 'active'").get(shopId, owner.id).count, 1);

  await request(app).get(`/shops/${shopId}`).expect(200).expect(/乡邻小铺/).expect(/乡邻发布/).expect(/具体位置请联系卖家/).expect((response) => assert.equal(response.text.includes("青河村村口小卖部旁"), true));
  await neighbour
    .get(`/merchant/home-shop/${shopId}/publish?type=local_produce`)
    .expect(200)
    .expect(/我要卖出去/)
    .expect(/我要买进来/)
    .expect(/已添加 0\/12/)
    .expect(/name="images"/)
    .expect((response) => {
      assert.ok(response.text.includes('name="price"'));
      assert.equal(response.text.includes('name="quantity"'), false);
      assert.equal(response.text.includes('name="source_note"'), false);
      assert.equal(response.text.includes('name="harvested_at"'), false);
      assert.equal(response.text.includes('name="pickup_location"'), false);
    });
  await neighbour
    .post(`/merchant/home-shop/${shopId}/publish`)
    .field("publish_intent", "sell")
    .field("name", "乡邻简化发布")
    .field("price", "8.80")
    .field("description", "乡邻小铺只保留名称、图片和描述。")
    .attach("images", imagePng, { filename: "simple-home-sell.png", contentType: "image/png" })
    .expect(302);
  const simpleHomeListing = db.prepare("SELECT * FROM personal_listings WHERE shop_id = ? AND name = ?").get(shopId, "乡邻简化发布");
  assert.equal(simpleHomeListing.listing_type, "product");
  assert.equal(simpleHomeListing.publication_status, "pending");
  await neighbour
    .post(`/merchant/home-shop/${shopId}/publish`)
    .field("publish_intent", "buy")
    .field("name", "乡邻简化求购")
    .field("price", "66.00")
    .field("description", "乡邻小铺发布的求购描述。")
    .attach("images", imagePng, { filename: "simple-home-buy.png", contentType: "image/png" })
    .expect(302);
  const simpleHomeWanted = db.prepare("SELECT * FROM wanted_posts WHERE title = ?").get("乡邻简化求购");
  assert.equal(simpleHomeWanted.description, "乡邻小铺发布的求购描述。");
  const tooManyImages = neighbour
    .post(`/merchant/home-shop/${shopId}/publish`)
    .field("listing_type", "local_produce")
    .field("name", "不应创建的超量图片测试")
    .field("category_id", "3")
    .field("description", "这条内容只用于验证后端数量限制。")
    .field("contact_phone", "13900000088");
  for (let index = 0; index < 13; index += 1) {
    tooManyImages.attach("images", imagePng, { filename: `too-many-${index}.png`, contentType: "image/png" });
  }
  await tooManyImages.expect(400).expect(/最多上传12张图片/);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM personal_listings WHERE name = ?").get("不应创建的超量图片测试").count, 0);
  await neighbour
    .post(`/merchant/home-shop/${shopId}/publish`)
    .field("listing_type", "local_produce")
    .field("name", "青河村丝瓜")
    .field("category_id", "3")
    .field("description", "自家菜园当天采摘，清洗后即可烹饪。")
    .field("stock_status", "有货")
    .field("condition", "自家发布")
    .field("contact_phone", "13900000088")
    .field("pickup", "on")
    .attach("images", imagePng, { filename: "produce-1.png", contentType: "image/png" })
    .attach("images", imagePng, { filename: "produce-2.png", contentType: "image/png" })
    .expect(302);
  const listing = db.prepare("SELECT * FROM personal_listings WHERE shop_id = ? AND name = ?").get(shopId, "青河村丝瓜");
  const listingImages = db.prepare("SELECT * FROM listing_images WHERE listing_id = ? ORDER BY sort_order").all(listing.id);
  assert.equal(listing.listing_type, "local_produce");
  assert.equal(listing.publication_status, "pending");
  assert.equal(listing.status, "inactive");
  assert.equal(listing.price, 0);
  assert.equal(listingImages.length, 2);
  assert.equal(listingImages[0].sort_order, 0);
  assert.equal(listing.image, listingImages[0].image_path);
  await request(app).get(`/listings/${listing.id}`).expect(404);
  await neighbour
    .get(`/listings/${listing.id}/edit`)
    .expect(200)
    .expect(/name="name"/)
    .expect(/name="price"/)
    .expect(/name="description"/)
    .expect((response) => {
      assert.equal(response.text.includes('name="category_id"'), false);
      assert.equal(response.text.includes('name="stock_status"'), false);
      assert.equal(response.text.includes('name="contact_phone"'), false);
    });

  await neighbour
    .post(`/merchant/home-shop/${shopId}/publish`)
    .type("form")
    .send({ listing_type: "service", title: "青河村上门修伞", description: "提供村内上门修伞服务。", pricing_method: "按次收费", service_area: "青河村及周边", available_time: "每天 09:00-17:00", contact_phone: "13900000088" })
    .expect(302);
  const homeService = db.prepare("SELECT publication_status, status FROM services WHERE shop_id = ? AND title = ?").get(shopId, "青河村上门修伞");
  assert.equal(homeService.publication_status, "pending");
  assert.equal(homeService.status, "inactive");

  const admin = request.agent(app);
  await admin.post("/login").type("form").send({ username: "admin", password: "Admin12345!", next: "/admin/shop-reviews" }).expect(302);
  await admin.get("/admin/shop-reviews").expect(200).expect(/乡邻发布审核/).expect(/青河村丝瓜/);
  await admin.post(`/admin/content/listing/${listing.id}/review`).type("form").send({ action: "reject", review_reason: "请补充农货照片" }).expect(302);
  assert.equal(db.prepare("SELECT publication_status, review_reason FROM personal_listings WHERE id = ?").get(listing.id).publication_status, "rejected");
  await neighbour.get(`/merchant/dashboard?shop=${shopId}`).expect(200).expect(/请补充农货照片/);
  await neighbour
    .post(`/listings/${listing.id}/edit`)
    .field("category_id", "3")
    .field("name", "青河村丝瓜")
    .field("spec", "一篮")
    .field("description", "自家菜园当天采摘")
    .field("stock_status", "有货")
    .field("condition", "自家发布")
    .field("village", "青河村")
    .field("contact_phone", "13900000088")
    .field("pickup", "on")
    .field("keep_images", listingImages[0].image_path)
    .attach("images", imagePng, { filename: "produce-edited.png", contentType: "image/png" })
    .expect(302);
  const editedImages = db.prepare("SELECT * FROM listing_images WHERE listing_id = ? ORDER BY sort_order").all(listing.id);
  assert.equal(editedImages.length, 2);
  assert.equal(editedImages[0].image_path, listingImages[0].image_path);
  assert.equal(editedImages[1].sort_order, 1);
  assert.equal(db.prepare("SELECT publication_status, status, review_reason FROM personal_listings WHERE id = ?").get(listing.id).publication_status, "pending");
  await admin.post(`/admin/content/listing/${listing.id}/review`).type("form").send({ action: "approve" }).expect(302);
  const reviewedListing = db.prepare("SELECT publication_status, status FROM personal_listings WHERE id = ?").get(listing.id);
  assert.equal(reviewedListing.publication_status, "published");
  assert.equal(reviewedListing.status, "active");
  await request(app).get(`/listings/${listing.id}`).expect(200).expect(/商品已审核 · 乡邻发布/).expect(/data-listing-gallery/).expect((response) => {
    assert.equal((response.text.match(/listing-gallery-cover/g) || []).length, 1);
  });

  const outsider = request.agent(app);
  await outsider.post("/auth/wechat/dev").type("form").send({ openid: "home_shop_outsider", next: "/" }).expect(302);
  await outsider.post(`/merchant/home-shop/${shopId}/publish`).type("form").send({ listing_type: "local_produce" }).expect(403);

  await neighbour.get("/account/shops").expect(200).expect(/关闭并删除店铺/);
  await neighbour.get(`/account/shops/${shopId}/delete`).expect(200).expect(/确认删除店铺/);
  await outsider.get(`/account/shops/${shopId}/delete`).expect(404);
  await neighbour.post(`/account/shops/${shopId}/delete`).type("form").send({ confirm_text: "删除" }).expect(400);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM shops WHERE id = ?").get(shopId).count, 1);
  await neighbour.post(`/account/shops/${shopId}/delete`).type("form").send({ confirm_text: "删除店铺" }).expect(302);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM shops WHERE id = ?").get(shopId).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM personal_listings WHERE id = ?").get(listing.id).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM services WHERE shop_id = ?").get(shopId).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM store_members WHERE store_id = ?").get(shopId).count, 0);
  await request(app).get(`/shops/${shopId}`).expect(404);
});

test("admin login shortcut opens existing auth flow", async () => {
  await request(app).get("/login").expect(302).expect("Location", "/auth?next=%2F");
  await request(app)
    .get("/admin/login")
    .expect(200)
    .expect(/管理员登录/)
    .expect((response) => {
      assert.equal(response.text.includes("/register"), false);
      assert.equal(response.text.includes("微信登录"), false);
      assert.equal(response.text.includes("去注册"), false);
    });
  await request(app)
    .post("/register")
    .type("form")
    .send({ username: "admin_probe_user", village: "测试村", password: "Probe12345!", next: "/" })
    .expect(302);
  await request(app).post("/login").type("form").send({ username: "admin_probe_user", password: "Probe12345!", next: "/admin/dashboard" }).expect(403);
  const admin = request.agent(app);
  await admin.post("/login").type("form").send({ username: "admin", password: "Admin12345!", next: "/admin/dashboard" }).expect(302);
  await admin.get("/admin/login").expect(302).expect("Location", "/admin/dashboard");
});
