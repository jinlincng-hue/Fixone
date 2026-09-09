# FixOne配件库

FixOne 维修生态下的配件信息、商家入驻、配件发布与求购 MVP。用户可以查找配件、查看商家、发布配件供应或求购；商家可以申请入驻并在审核通过后管理配件商品；管理员可以审核商家和处理违规内容。

## 技术栈

- Node.js 22.5+（当前验证环境为 Node 24.14.1）
- Express + EJS
- SQLite（使用 Node 内置 `node:sqlite`，避免 Windows 原生编译依赖）
- Multer 2.x 图片上传
- bcryptjs 密码哈希
- express-session 会话登录
- 微信网页 OAuth（环境变量配置；未配置时自动回退旧密码入口）
- Leaflet + OpenStreetMap 地图选点

> Node 当前会对 `node:sqlite` 输出 ExperimentalWarning，不影响运行。若生产环境要求完全无实验警告，可后续切换到带预编译支持的 SQLite 驱动或固定运行时。

## 快速启动

```bash
npm install
npm run db:init
npm start
```

开发模式：

```bash
npm run dev
```

访问：

```text
http://localhost:3001
```

重建本地数据库：

```bash
npm run db:reset
```

## 初始账号

| 角色 | 用户名 | 密码 |
| --- | --- | --- |
| 管理员 | `admin` | `Admin12345!` |

初始化脚本只创建系统分类和管理员账号，不再内置演示商家、商品、服务、个人发布或求购。普通村民和商家账号都通过页面注册；商家提交入驻申请并经管理员审核通过后，才会生成公开店铺并出现在“本地商家”。

## 商家入驻与微信登录

- 新用户默认使用微信一键登录。手机号可为空，未绑定手机号时需要使用当前微信再次登录。
- 原有用户名密码登录、注册和旧版商家申请表继续保留，作为迁移兼容入口。
- 商家入驻入口：`/merchant/apply`。用户先在 `/merchant/onboarding/:storeId/type` 选择经营方式，再创建空间或认领已有店铺。
- 经营方式只有两种：`verified_store`（认证实体店）和 `home_shop`（乡邻小铺）。旧的农户、服务者、摊位类型仅保留在旧字段中用于兼容。
- 认证实体店依次填写一个店铺分类、门面与店内实拍、详细地址地图、营业信息、配送能力和营业执照；通过人工审核后显示“平台已核验”。
- 乡邻小铺只填写小铺名称（可自动生成）、镇村、一句话介绍、联系方式和约定自提点；不要求营业执照、经营分类、营业状态或精确家庭地址，公开页显示“乡邻小铺 / 乡邻发布”。
- 店铺草稿保存在 `shops` 表中，退出后重新登录可继续填写；实体店未审核前不能发布普通商品，乡邻小铺创建后可发布但内容会先审核。
- 店铺电话与 `users.phone` 分开保存。账号电话可以为空且不会公开。
- 店内实拍最多 9 张，门面封面与店内图使用随机文件名保存到 `public/uploads/shops/`；营业执照和其他资质保存在非公开的 `data/licenses/`。
- 认领申请审核通过后才会创建 `shop_members` 店主成员记录，用户不能自行取得他人店铺管理权限。

管理员审核入口：

```text
/admin/shop-reviews
```

审核可通过、要求补充资料、拒绝或暂停。要求补充时必须写明原因，并可标记需要修改的向导步骤。页面同时提供“乡邻发布审核”队列，管理员可通过、拒绝（必须填写原因）或下架乡邻小铺内容。

## 已实现功能

- 首页：导航、主视觉搜索、帮我问全镇、商品分类、附近好店、今日好物、全镇都在找、便民服务、配送到村、平台已核验商户。
- 商品：附近商品列表、分类页、商品详情页、搜索结果页。
- 商家：商家列表、商家详情、平台已核验标识、登录后查看完整联系电话。
- 普通村民：注册登录、发布个人二手、自家农产品、全镇求购、编辑/下架自己的发布。
- 认证实体店：上传营业执照、查看审核状态；审核通过且执照已核验后，普通商品直接公开。医药健康分类、敏感关键词及平台要求复审的内容仍进入审核。
- 乡邻小铺：发布自家农货、闲置二手和本地服务；每条内容默认待审核，拒绝原因会显示给发布者，修改后保留原图片并重新进入审核。
- 商家入驻升级：微信 OAuth、开发环境测试微信登录、分步店铺草稿、门面/店内图片排序、地图拖动选点、店铺认领、多店铺成员数据模型、审核补充资料流程。
- 管理员：审核入驻申请、查看营业执照、通过/拒绝并填写理由、管理商品/便民服务/个人发布/求购/举报、禁用账号。
- 便民服务：只展示已核验商家账号发布的药店送药、家电维修、送水到家、跑腿代办、电动车维修、五金维修等服务。
- 安全基础：密码哈希、上传格式和 2MB 大小限制、管理员鉴权、用户只能修改自己的内容、执照文件不放公开静态目录。

## 数据库

SQLite 文件默认保存到：

```text
data/fixone-parts.sqlite
```

包含表：

- `users`
- `merchant_applications`
- `shops`
- `categories`
- `products`
- `personal_listings`
- `wanted_posts`
- `services`
- `reports`
- `shop_members`
- `store_members`
- `shop_media`
- `shop_credentials`
- `shop_claim_applications`
- `shop_review_events`

`users` 已增量扩展 `wechat_openid`、`wechat_unionid`、`display_name`、`avatar_url`、`phone_verified_at`、`updated_at` 字段。由于原 MVP 的 `users.phone` 是非空列，微信新用户以空字符串表示未绑定手机号，语义上等同于未绑定；不会重建原表或影响旧手机号账户。

`shops` 已增量扩展审核状态、旧商家类型、`business_mode`、分类、封面/店内图片、地址经纬度、店铺联系方式、营业状态、配送能力、资质和审核记录等字段。旧类型 `entity` 映射为 `verified_store`；`farmer`、`provider`、`temporary` 映射为 `home_shop`，原字段、店铺 ID、URL 和图片不变。旧店铺会自动保留为已通过状态，并生成兼容的店主成员记录。

`products`、`personal_listings` 和 `services` 增量增加 `listing_type`、`publication_status`、`review_reason`、`reviewed_by`、`reviewed_at` 等字段；保留旧 `status` 字段兼容既有列表与链接。`store_members` 预留 `owner`、`manager`、`staff` 角色，当前仍沿用 `shop_members` 的实际权限逻辑。

`npm start` 不会清空数据库，重启后数据仍保留。

## 图片资源

当前已接入两张无水印实拍图：

- `public/assets/images/fixone-parts-old-street.jpg`：首页主视觉
- `public/assets/images/fixone-parts-bridge.png`：FixOne配件库区域

带“星沙时报”或“百度百科”水印的图片没有接入，也不建议去水印后使用。其他占位图片仍位于 `public/assets/images/`，可替换：

- `public/assets/images/shop-*.svg`：商户占位图
- `public/assets/images/*.svg`：商品和服务占位图

## 地图接入

项目新增 `/map` 页面，使用 Leaflet + OpenStreetMap 免费底图，不需要高德、百度或腾讯地图付费密钥。当前点位：

- FixOne配件库中心：`28.4638705, 113.3307214`（OpenStreetMap Nominatim）
- FixOne配件库展示风貌点

商家点位来自审核通过后的 `shops` 数据。商家入驻向导已支持保存 `latitude`、`longitude`；已填写真实坐标时优先显示，旧店铺仍使用镇中心附近的兼容点位。

## 环境变量

复制 `.env.example` 为 `.env` 后修改：

```bash
cp .env.example .env
```

生产环境至少设置：

```text
NODE_ENV=production
PORT=3001
DB_PATH=data/fixone-parts.sqlite
SESSION_SECRET=请填写足够长的随机字符串
```

### 配置微信登录

1. 在微信开放平台或服务号网页授权配置中登记回调地址：`https://你的域名/auth/wechat/callback`。
2. 将应用的 AppID、AppSecret 和回调地址写入服务器 `.env`，不要提交真实密钥：

```text
WECHAT_APP_ID=wx...
WECHAT_APP_SECRET=...
WECHAT_REDIRECT_URI=https://your-domain.example/auth/wechat/callback
```

3. 重启服务。未配置三项中的任意一项时，微信入口会显示友好提示，旧用户名密码登录仍可使用。
4. 本地开发可临时设置 `WECHAT_DEV_LOGIN=true` 使用测试微信用户；生产环境即使设置该变量也会自动禁用该入口。

## PM2 部署

```bash
npm install
npm run db:init
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
```

## Nginx 反向代理

参考 `nginx.fixone-parts.example.conf`：

```nginx
server {
    listen 80;
    server_name parts.fixone.cloud;

    client_max_body_size 3m;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 测试

```bash
npm test
```

测试覆盖：

- 首页、空商家页、空商品页、空便民服务页、空求购页打开。
- 搜索和分类空状态。
- 普通用户注册、登录、发布闲置、发布求购。
- 商家申请入驻并上传执照。
- 管理员审核商家。
- 审核通过商家出现在“本地商家”，并能发布商品和便民服务。
- 微信未配置时安全回退、本地测试微信登录、手机号为空的店铺草稿、真实图片类型校验、店铺审核补充资料、审核通过和店铺认领权限。
- 认证实体店普通商品直发、敏感分类转待审、乡邻小铺无执照创建、乡邻农货和本地服务默认待审、管理员拒绝后修改重提、管理员通过后公开展示。

## 下一阶段建议

- 真实图片素材和线下核验流程文案。
- 更细的村庄/距离筛选。
- 内容审核日志和更完整的操作审计。
- 站内消息或电话保护拨号页。
- 商家库存批量管理。
- 更严格的 CSRF 防护和生产级 session 存储。
