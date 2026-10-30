-- CreateTable
CREATE TABLE "ShopSession" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "scope" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopBilling" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "installationId" TEXT,
    "freePlanSelectedAt" TIMESTAMP(3),
    "subscriptionId" TEXT,
    "subscriptionStatus" TEXT,
    "pendingSubscriptionId" TEXT,
    "pendingPlan" TEXT,
    "lastChargeResult" TEXT,
    "lastChargeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopBilling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EditLog" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT,
    "changes" TEXT NOT NULL,
    "previousValues" TEXT,
    "undone" BOOLEAN NOT NULL DEFAULT false,
    "undoneAt" TIMESTAMP(3),
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errorMsg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopSession_shop_key" ON "ShopSession"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "ShopBilling_shop_key" ON "ShopBilling"("shop");

-- CreateIndex
CREATE INDEX "EditLog_shop_createdAt_idx" ON "EditLog"("shop", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UsageCounter_shop_period_key" ON "UsageCounter"("shop", "period");

