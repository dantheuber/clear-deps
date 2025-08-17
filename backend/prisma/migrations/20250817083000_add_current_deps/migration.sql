-- CreateTable: DependencyMappingOverride (if not existing)
CREATE TABLE IF NOT EXISTS "DependencyMappingOverride" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "parentServiceId" TEXT NOT NULL,
  "dependencyName" TEXT NOT NULL,
  "mappedServiceId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "DependencyMappingOverride_parentServiceId_fkey" FOREIGN KEY ("parentServiceId") REFERENCES "Service" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DependencyMappingOverride_mappedServiceId_fkey" FOREIGN KEY ("mappedServiceId") REFERENCES "Service" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Indices & unique constraints (use IF NOT EXISTS guards for idempotence)
CREATE UNIQUE INDEX IF NOT EXISTS "DependencyMappingOverride_parentServiceId_dependencyName_key" ON "DependencyMappingOverride" ("parentServiceId", "dependencyName");
CREATE INDEX IF NOT EXISTS "DependencyMappingOverride_mappedServiceId_idx" ON "DependencyMappingOverride" ("mappedServiceId");

-- CreateTable: ServiceDependencyCurrent
CREATE TABLE "ServiceDependencyCurrent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "parentServiceId" TEXT NOT NULL,
  "dependencyName" TEXT NOT NULL,
  "dependencyType" TEXT,
  "mappedServiceId" TEXT,
  "status" TEXT NOT NULL,
  "metaJson" TEXT,
  "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ServiceDependencyCurrent_parentServiceId_fkey" FOREIGN KEY ("parentServiceId") REFERENCES "Service" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ServiceDependencyCurrent_mappedServiceId_fkey" FOREIGN KEY ("mappedServiceId") REFERENCES "Service" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ServiceDependencyCurrent_parentServiceId_dependencyName_key" ON "ServiceDependencyCurrent" ("parentServiceId", "dependencyName");
CREATE INDEX "ServiceDependencyCurrent_mappedServiceId_idx" ON "ServiceDependencyCurrent" ("mappedServiceId");
CREATE INDEX "ServiceDependencyCurrent_parentServiceId_idx" ON "ServiceDependencyCurrent" ("parentServiceId");
