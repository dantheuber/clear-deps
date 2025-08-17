-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'default',
    "endpointUrl" TEXT NOT NULL,
    "tagsJson" TEXT,
    "owner" TEXT,
    "pollIntervalOverrideSec" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastPolledAt" DATETIME,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "PollRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serviceId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "success" BOOLEAN NOT NULL,
    "httpStatus" INTEGER,
    "durationMs" INTEGER,
    "errorMessage" TEXT,
    CONSTRAINT "PollRun_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Dependency" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pollRunId" TEXT NOT NULL,
    "parentServiceId" TEXT NOT NULL,
    "dependencyName" TEXT NOT NULL,
    "dependencyType" TEXT,
    "mappedServiceId" TEXT,
    "status" TEXT NOT NULL,
    "metaJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Dependency_pollRunId_fkey" FOREIGN KEY ("pollRunId") REFERENCES "PollRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Dependency_parentServiceId_fkey" FOREIGN KEY ("parentServiceId") REFERENCES "Service" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Dependency_mappedServiceId_fkey" FOREIGN KEY ("mappedServiceId") REFERENCES "Service" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServiceStatusCurrent" (
    "serviceId" TEXT NOT NULL PRIMARY KEY,
    "overallStatus" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceStatusCurrent_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DependencyHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serviceId" TEXT NOT NULL,
    "dependencyName" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    CONSTRAINT "DependencyHistory_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GraphEdge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromServiceId" TEXT NOT NULL,
    "toServiceId" TEXT,
    "dependencyName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GraphEdge_fromServiceId_fkey" FOREIGN KEY ("fromServiceId") REFERENCES "Service" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GraphEdge_toServiceId_fkey" FOREIGN KEY ("toServiceId") REFERENCES "Service" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Service_name_environment_idx" ON "Service"("name", "environment");

-- CreateIndex
CREATE UNIQUE INDEX "Service_name_environment_key" ON "Service"("name", "environment");

-- CreateIndex
CREATE INDEX "Dependency_parentServiceId_dependencyName_idx" ON "Dependency"("parentServiceId", "dependencyName");

-- CreateIndex
CREATE INDEX "DependencyHistory_serviceId_dependencyName_timestamp_idx" ON "DependencyHistory"("serviceId", "dependencyName", "timestamp");

-- CreateIndex
CREATE INDEX "GraphEdge_fromServiceId_idx" ON "GraphEdge"("fromServiceId");

-- CreateIndex
CREATE INDEX "GraphEdge_toServiceId_idx" ON "GraphEdge"("toServiceId");
