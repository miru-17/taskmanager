-- CreateIndex
CREATE INDEX "Task_projectId_dueDate_idx" ON "Task"("projectId", "dueDate");

-- CreateIndex
CREATE INDEX "AutomationRun_taskId_idx" ON "AutomationRun"("taskId");

