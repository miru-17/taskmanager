import { registerJob } from "../../core/queue";
import { AUTOMATION_JOB } from "./emit";
import { processEvent, runTimeSweep } from "./engine";

export const AUTOMATION_SWEEP_JOB = "automation.sweep";

/** Registers the automation jobs with the queue (call once at startup, and in tests). */
export const registerAutomationJobs = () => {
  registerJob(AUTOMATION_JOB, async (data) => {
    await processEvent(data);
  });
  registerJob(AUTOMATION_SWEEP_JOB, async () => {
    await runTimeSweep();
  });
};
