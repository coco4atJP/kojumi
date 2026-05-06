import fs from 'fs';
import path from 'path';
import { prisma } from './index';
import { logger } from './logger';

export function startCleanupJob() {
  const retentionHours = Number(process.env.KOJUMI_RETENTION_HOURS || 24);
  const intervalHours = Number(process.env.KOJUMI_CLEANUP_INTERVAL_HOURS || 1);

  const RETENTION_PERIOD_MS = retentionHours * 60 * 60 * 1000;
  const CLEANUP_INTERVAL_MS = intervalHours * 60 * 60 * 1000;

  logger.info({ interval_hours: intervalHours, retention_hours: retentionHours }, 'Scheduled delivery cleanup job started');
  
  const cleanupTimer = setInterval(async () => {
    try {
      logger.info('Running scheduled cleanup for old deliveries');
      
      const thresholdDate = new Date(Date.now() - RETENTION_PERIOD_MS);

      // Find local deliveries older than the retention period
      const oldDeliveries = await prisma.delivery.findMany({
        where: {
          createdAt: { lt: thresholdDate },
          outputUri: { startsWith: 'local://' }
        }
      });

      let deletedCount = 0;

      for (const delivery of oldDeliveries) {
        const filePath = delivery.outputUri.replace('local://', '');
        const absolutePath = path.resolve(__dirname, '../', filePath);

        if (fs.existsSync(absolutePath)) {
          try {
            await fs.promises.unlink(absolutePath);
            deletedCount++;
          } catch (e) {
            logger.error({ file: absolutePath, error: e }, 'Failed to delete file');
          }
        }

        // Update the DB to indicate it was purged to avoid trying to delete it again
        // and to clearly communicate the platform's zero-retention policy to users
        await prisma.delivery.update({
          where: { id: delivery.id },
          data: { outputUri: 'purged://retention_period_expired' }
        });
      }

      if (deletedCount > 0) {
        logger.info({ deleted_count: deletedCount }, 'Purged old delivery files');
      }
    } catch (error) {
      logger.error({ error }, 'Failed during delivery cleanup job');
    }
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();
}
