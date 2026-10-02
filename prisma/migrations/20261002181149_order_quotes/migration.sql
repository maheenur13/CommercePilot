-- CreateTable
CREATE TABLE "OrderQuote" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderQuote_orderId_key" ON "OrderQuote"("orderId");

-- CreateIndex
CREATE INDEX "OrderQuote_customerId_idx" ON "OrderQuote"("customerId");

-- AddForeignKey
ALTER TABLE "OrderQuote" ADD CONSTRAINT "OrderQuote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderQuote" ADD CONSTRAINT "OrderQuote_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
