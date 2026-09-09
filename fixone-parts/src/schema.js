function columnNames(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
}

function addColumn(db, table, definition) {
  const name = definition.trim().split(/\s+/)[0];
  if (!columnNames(db, table).has(name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

function applyMigrations(db) {
  // The original MVP tables remain intact. These are additive migrations so existing
  // password accounts, shops, applications, images, and SQLite files keep working.
  [
    "wechat_openid TEXT",
    "wechat_unionid TEXT",
    "display_name TEXT",
    "avatar_url TEXT",
    "phone_verified_at TEXT",
    "updated_at TEXT"
  ].forEach((definition) => addColumn(db, "users", definition));

  [
    "review_status TEXT NOT NULL DEFAULT 'approved'",
    "merchant_type TEXT NOT NULL DEFAULT 'entity'",
    "primary_category_id INTEGER",
    "secondary_category_ids TEXT",
    "short_name TEXT",
    "open_year TEXT",
    "announcement TEXT",
    "description TEXT",
    "province TEXT",
    "city TEXT",
    "district TEXT",
    "town TEXT",
    "village TEXT",
    "address_detail TEXT",
    "latitude REAL",
    "longitude REAL",
    "cover_image TEXT",
    "contact_wechat TEXT",
    "preferred_contact TEXT NOT NULL DEFAULT 'phone'",
    "public_phone INTEGER NOT NULL DEFAULT 1",
    "allow_consultation INTEGER NOT NULL DEFAULT 0",
    "weekly_schedule TEXT",
    "opening_time TEXT",
    "closing_time TEXT",
    "noon_break INTEGER NOT NULL DEFAULT 0",
    "business_state TEXT NOT NULL DEFAULT 'open'",
    "service_tags TEXT",
    "delivery_radius REAL",
    "minimum_order REAL",
    "delivery_fee REAL",
    "free_delivery_condition TEXT",
    "delivery_time_note TEXT",
    "verification_label TEXT",
    "subject_name TEXT",
    "credit_code TEXT",
    "applicant_relation TEXT",
    "review_note TEXT",
    "review_reason TEXT",
    "review_fields TEXT",
    "reviewed_at TEXT",
    "reviewed_by INTEGER",
    "claimable INTEGER NOT NULL DEFAULT 1",
    "business_mode TEXT",
    "pickup_location TEXT"
  ].forEach((definition) => addColumn(db, "shops", definition));

  ["requires_review INTEGER NOT NULL DEFAULT 0"].forEach((definition) => addColumn(db, "categories", definition));

  [
    "listing_type TEXT NOT NULL DEFAULT 'product'",
    "publication_status TEXT NOT NULL DEFAULT 'published'",
    "review_reason TEXT",
    "reviewed_by INTEGER",
    "reviewed_at TEXT",
    "original_price REAL",
    "quantity TEXT",
    "source_note TEXT",
    "harvested_at TEXT",
    "used_duration TEXT",
    "defect_description TEXT",
    "negotiable INTEGER NOT NULL DEFAULT 0",
    "pickup_location TEXT",
    "pricing_method TEXT"
  ].forEach((definition) => addColumn(db, "products", definition));

  [
    "shop_id INTEGER REFERENCES shops(id) ON DELETE SET NULL",
    "listing_type TEXT",
    "publication_status TEXT NOT NULL DEFAULT 'published'",
    "review_reason TEXT",
    "reviewed_by INTEGER",
    "reviewed_at TEXT",
    "original_price REAL",
    "quantity TEXT",
    "source_note TEXT",
    "harvested_at TEXT",
    "used_duration TEXT",
    "defect_description TEXT",
    "negotiable INTEGER NOT NULL DEFAULT 0",
    "pickup_location TEXT",
    "pricing_method TEXT"
  ].forEach((definition) => addColumn(db, "personal_listings", definition));

  [
    "user_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
    "listing_type TEXT NOT NULL DEFAULT 'service'",
    "publication_status TEXT NOT NULL DEFAULT 'published'",
    "review_reason TEXT",
    "reviewed_by INTEGER",
    "reviewed_at TEXT",
    "pricing_method TEXT",
    "pickup_location TEXT"
  ].forEach((definition) => addColumn(db, "services", definition));

  [
    "description TEXT NOT NULL DEFAULT ''",
    "image TEXT"
  ].forEach((definition) => addColumn(db, "wanted_posts", definition));

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wechat_openid
      ON users(wechat_openid) WHERE wechat_openid IS NOT NULL;

    CREATE TABLE IF NOT EXISTS shop_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'clerk')),
      status TEXT NOT NULL CHECK(status IN ('active', 'inactive')) DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(shop_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS store_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('owner', 'manager', 'staff')),
      status TEXT NOT NULL CHECK(status IN ('active', 'inactive')) DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(store_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS shop_media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      media_type TEXT NOT NULL CHECK(media_type IN ('interior')),
      file_path TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shop_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      credential_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      original_name TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shop_claim_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      relationship TEXT NOT NULL,
      invite_code TEXT,
      license_file_name TEXT,
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK(status IN ('draft', 'pending', 'changes_requested', 'approved', 'rejected', 'suspended')),
      review_note TEXT,
      review_reason TEXT,
      review_fields TEXT,
      reviewed_at TEXT,
      reviewed_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(shop_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS shop_review_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
      claim_application_id INTEGER REFERENCES shop_claim_applications(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      note TEXT,
      fields TEXT,
      reviewer_user_id INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS listing_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id INTEGER NOT NULL REFERENCES personal_listings(id) ON DELETE CASCADE,
      image_path TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE(listing_id, image_path)
    );

    CREATE TABLE IF NOT EXISTS product_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      image_path TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE(product_id, image_path)
    );

    CREATE TABLE IF NOT EXISTS item_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL CHECK(target_type IN ('product', 'listing')),
      target_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'visible' CHECK(status IN ('visible', 'hidden')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS message_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      buyer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      seller_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK(target_type IN ('product', 'listing')),
      target_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      image TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'closed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(buyer_user_id, seller_user_id, target_type, target_id)
    );

    CREATE TABLE IF NOT EXISTS direct_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id INTEGER NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
      sender_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_shop_members_user ON shop_members(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_store_members_user ON store_members(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_shops_review_status ON shops(review_status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_shops_business_mode ON shops(business_mode, review_status, status);
    CREATE INDEX IF NOT EXISTS idx_shop_media_shop ON shop_media(shop_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_shop_claims_status ON shop_claim_applications(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_listing_images_listing ON listing_images(listing_id, sort_order, id);
    CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id, sort_order, id);
    CREATE INDEX IF NOT EXISTS idx_item_comments_target ON item_comments(target_type, target_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_item_comments_user ON item_comments(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_message_threads_buyer ON message_threads(buyer_user_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_message_threads_seller ON message_threads(seller_user_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_direct_messages_thread ON direct_messages(thread_id, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_products_publication_status ON products(publication_status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_listings_publication_status ON personal_listings(publication_status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_services_publication_status ON services(publication_status, updated_at);
  `);

  const timestamp = new Date().toISOString();
  db.prepare("UPDATE users SET updated_at = COALESCE(updated_at, created_at, ?) WHERE updated_at IS NULL").run(timestamp);
  db.prepare("UPDATE shops SET cover_image = COALESCE(cover_image, logo_image) WHERE cover_image IS NULL OR cover_image = ''").run();
  db.prepare("UPDATE shops SET review_status = COALESCE(review_status, 'approved') WHERE review_status IS NULL OR review_status = ''").run();
  db.prepare("UPDATE shops SET claimable = 0 WHERE review_status <> 'approved'").run();
  db.prepare("UPDATE shops SET verification_label = CASE WHEN verified = 1 THEN 'platform_verified' ELSE COALESCE(verification_label, 'unverified') END WHERE verification_label IS NULL OR verification_label = ''").run();
  db.prepare(
    `UPDATE shops
     SET business_mode = CASE
       WHEN merchant_type IN ('entity', 'verified_store') THEN 'verified_store'
       WHEN merchant_type IN ('farmer', 'provider', 'temporary', 'home_shop') THEN 'home_shop'
       ELSE business_mode
     END
     WHERE business_mode IS NULL OR business_mode = '' OR business_mode NOT IN ('verified_store', 'home_shop')`
  ).run();
  db.prepare("UPDATE shops SET verification_label = 'neighbour' WHERE business_mode = 'home_shop'").run();
  db.prepare("UPDATE shops SET verified = 0 WHERE business_mode = 'home_shop'").run();
  // init-db seeds the original eight categories after migrations. Avoid consuming
  // their historical SQLite ids on a brand-new database, then extend old databases.
  if (db.prepare("SELECT COUNT(*) AS count FROM categories").get().count > 0) {
    db.prepare("INSERT OR IGNORE INTO categories (name, slug, icon, sort_order) VALUES ('餐饮美食', 'restaurant', 'utensils', 9)").run();
    db.prepare("INSERT OR IGNORE INTO categories (name, slug, icon, sort_order) VALUES ('生活服务', 'life-service', 'wrench', 10)").run();
  }
  db.prepare("UPDATE categories SET requires_review = 1 WHERE slug = 'medical'").run();
  db.prepare("UPDATE products SET listing_type = CASE WHEN publish_type IN ('个人二手', '闲置二手') THEN 'secondhand' WHEN publish_type IN ('自家农产品', '本地农货') THEN 'local_produce' ELSE 'product' END WHERE listing_type IS NULL OR listing_type = ''").run();
  db.prepare("UPDATE products SET publication_status = CASE WHEN status = 'active' THEN 'published' ELSE 'offline' END WHERE publication_status IS NULL OR publication_status = '' OR (publication_status = 'published' AND status <> 'active')").run();
  db.prepare("UPDATE personal_listings SET listing_type = CASE WHEN type = 'farm' THEN 'local_produce' ELSE 'secondhand' END WHERE listing_type IS NULL OR listing_type = ''").run();
  db.prepare("UPDATE personal_listings SET publication_status = CASE WHEN status = 'active' THEN 'published' ELSE 'offline' END WHERE publication_status IS NULL OR publication_status = '' OR (publication_status = 'published' AND status <> 'active')").run();
  db.prepare(
    `INSERT OR IGNORE INTO listing_images (listing_id, image_path, sort_order, created_at)
     SELECT l.id, l.image, 0, COALESCE(l.created_at, ?)
     FROM personal_listings l
     WHERE l.image IS NOT NULL
       AND l.image <> ''
       AND l.image NOT LIKE '/assets/%'
       AND NOT EXISTS (
         SELECT 1 FROM listing_images li
         WHERE li.listing_id = l.id AND li.image_path = l.image
       )`
  ).run(timestamp);
  db.prepare(
    `INSERT OR IGNORE INTO product_images (product_id, image_path, sort_order, created_at)
     SELECT p.id, p.image, 0, COALESCE(p.created_at, ?)
     FROM products p
     WHERE p.image IS NOT NULL
       AND p.image <> ''
       AND p.image NOT LIKE '/assets/%'
       AND NOT EXISTS (
         SELECT 1 FROM product_images pi
         WHERE pi.product_id = p.id AND pi.image_path = p.image
       )`
  ).run(timestamp);
  db.prepare("UPDATE services SET listing_type = 'service' WHERE listing_type IS NULL OR listing_type = ''").run();
  db.prepare("UPDATE services SET publication_status = CASE WHEN status = 'active' THEN 'published' ELSE 'offline' END WHERE publication_status IS NULL OR publication_status = '' OR (publication_status = 'published' AND status <> 'active')").run();
  db.prepare(
    `INSERT OR IGNORE INTO shop_members (shop_id, user_id, role, status, created_at, updated_at)
     SELECT id, user_id, 'owner', 'active', created_at, updated_at FROM shops`
  ).run();
  db.prepare(
    `INSERT OR IGNORE INTO store_members (store_id, user_id, role, status, created_at, updated_at)
     SELECT shop_id, user_id,
       CASE role WHEN 'owner' THEN 'owner' WHEN 'admin' THEN 'manager' ELSE 'staff' END,
       status, created_at, updated_at
     FROM shop_members`
  ).run();
  db.prepare(
    `INSERT OR IGNORE INTO store_members (store_id, user_id, role, status, created_at, updated_at)
     SELECT id, user_id, 'owner', 'active', created_at, updated_at FROM shops`
  ).run();
}

module.exports = { applyMigrations };
