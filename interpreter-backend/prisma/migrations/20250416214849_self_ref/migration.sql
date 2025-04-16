-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "senderType" TEXT NOT NULL,
    "originalText" TEXT NOT NULL,
    "translatedText" TEXT,
    "language" TEXT NOT NULL,
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "originalMessageId" TEXT,
    CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Message_originalMessageId_fkey" FOREIGN KEY ("originalMessageId") REFERENCES "Message" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Message" ("conversationId", "id", "isFinal", "language", "originalText", "senderType", "timestamp", "translatedText") SELECT "conversationId", "id", "isFinal", "language", "originalText", "senderType", "timestamp", "translatedText" FROM "Message";
DROP TABLE "Message";
ALTER TABLE "new_Message" RENAME TO "Message";
CREATE INDEX "Message_originalMessageId_idx" ON "Message"("originalMessageId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
