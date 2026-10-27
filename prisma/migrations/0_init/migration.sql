-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "AppIdentity" (
    "id" TEXT NOT NULL DEFAULT 'app',
    "name" TEXT NOT NULL,
    "ownerName" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jakarta',
    "locale" TEXT NOT NULL DEFAULT 'id-ID',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "role" TEXT NOT NULL DEFAULT 'OPERATOR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Committee" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "shareParentCounter" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Committee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "unitId" TEXT,
    "committeeId" TEXT,
    "includeCommittees" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LetterType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LetterType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberingProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "committeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NumberingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberingProfileVersion" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "dsl" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "namespaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NumberingProfileVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CounterNamespace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitId" TEXT,
    "committeeId" TEXT,
    "resetPolicy" TEXT NOT NULL DEFAULT 'ALL',
    "dateSource" TEXT NOT NULL DEFAULT 'LETTER_DATE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CounterNamespace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Counter" (
    "id" TEXT NOT NULL,
    "namespaceId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL DEFAULT 'ALL',
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Letter" (
    "id" TEXT NOT NULL,
    "issuingUnitId" TEXT NOT NULL,
    "committeeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "letterDate" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "issuerId" TEXT,
    "sequence" INTEGER,
    "namespaceId" TEXT,
    "periodKey" TEXT,
    "officialNumber" TEXT,
    "normalizedNumber" TEXT,
    "profileVersionId" TEXT,
    "numberSnapshot" TEXT,
    "direction" TEXT,
    "letterTypeId" TEXT,
    "recipient" TEXT,
    "subject" TEXT,
    "notes" TEXT,
    "cancelReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "legacyNumber" TEXT,
    "isImported" BOOLEAN NOT NULL DEFAULT false,
    "importedAt" TIMESTAMP(3),
    "sourceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Letter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberRegistry" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "letterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NumberRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "letterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchiveFile" (
    "id" TEXT NOT NULL,
    "letterId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'original',
    "state" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArchiveFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchiveVersion" (
    "id" TEXT NOT NULL,
    "archiveFileId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "objectKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ArchiveVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "outcome" TEXT NOT NULL DEFAULT 'SUCCESS',
    "correlationId" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageBackend" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'LOCAL',
    "label" TEXT NOT NULL,
    "rootPath" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "testStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageBackend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sheet" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRY_RUN',
    "report" TEXT,
    "targetUnitId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "sheet" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "rawNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CANDIDATE',
    "data" TEXT NOT NULL,
    "issues" TEXT,
    "letterId" TEXT,

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_code_key" ON "Unit"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_storageKey_key" ON "Unit"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "Committee_storageKey_key" ON "Committee"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "Committee_unitId_code_key" ON "Committee"("unitId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "AccessAssignment_userId_unitId_committeeId_key" ON "AccessAssignment"("userId", "unitId", "committeeId");

-- CreateIndex
CREATE UNIQUE INDEX "LetterType_code_key" ON "LetterType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "NumberingProfile_committeeId_key" ON "NumberingProfile"("committeeId");

-- CreateIndex
CREATE UNIQUE INDEX "NumberingProfileVersion_profileId_version_key" ON "NumberingProfileVersion"("profileId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CounterNamespace_unitId_committeeId_name_key" ON "CounterNamespace"("unitId", "committeeId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Counter_namespaceId_periodKey_key" ON "Counter"("namespaceId", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "Letter_namespaceId_periodKey_sequence_key" ON "Letter"("namespaceId", "periodKey", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "NumberRegistry_number_key" ON "NumberRegistry"("number");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_actorId_operation_key_key" ON "IdempotencyKey"("actorId", "operation", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveVersion_objectKey_key" ON "ArchiveVersion"("objectKey");

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveVersion_archiveFileId_versionNo_key" ON "ArchiveVersion"("archiveFileId", "versionNo");

-- CreateIndex
CREATE UNIQUE INDEX "StorageBackend_label_key" ON "StorageBackend"("label");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRow_sourceHash_sheet_rowIndex_key" ON "ImportRow"("sourceHash", "sheet", "rowIndex");

-- AddForeignKey
ALTER TABLE "Committee" ADD CONSTRAINT "Committee_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessAssignment" ADD CONSTRAINT "AccessAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessAssignment" ADD CONSTRAINT "AccessAssignment_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessAssignment" ADD CONSTRAINT "AccessAssignment_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "Committee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NumberingProfile" ADD CONSTRAINT "NumberingProfile_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NumberingProfile" ADD CONSTRAINT "NumberingProfile_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "Committee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NumberingProfileVersion" ADD CONSTRAINT "NumberingProfileVersion_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "NumberingProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NumberingProfileVersion" ADD CONSTRAINT "NumberingProfileVersion_namespaceId_fkey" FOREIGN KEY ("namespaceId") REFERENCES "CounterNamespace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounterNamespace" ADD CONSTRAINT "CounterNamespace_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Counter" ADD CONSTRAINT "Counter_namespaceId_fkey" FOREIGN KEY ("namespaceId") REFERENCES "CounterNamespace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Letter" ADD CONSTRAINT "Letter_issuingUnitId_fkey" FOREIGN KEY ("issuingUnitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Letter" ADD CONSTRAINT "Letter_issuerId_fkey" FOREIGN KEY ("issuerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Letter" ADD CONSTRAINT "Letter_namespaceId_fkey" FOREIGN KEY ("namespaceId") REFERENCES "CounterNamespace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Letter" ADD CONSTRAINT "Letter_profileVersionId_fkey" FOREIGN KEY ("profileVersionId") REFERENCES "NumberingProfileVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Letter" ADD CONSTRAINT "Letter_letterTypeId_fkey" FOREIGN KEY ("letterTypeId") REFERENCES "LetterType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Letter" ADD CONSTRAINT "Letter_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "Committee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveFile" ADD CONSTRAINT "ArchiveFile_letterId_fkey" FOREIGN KEY ("letterId") REFERENCES "Letter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveVersion" ADD CONSTRAINT "ArchiveVersion_archiveFileId_fkey" FOREIGN KEY ("archiveFileId") REFERENCES "ArchiveFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

