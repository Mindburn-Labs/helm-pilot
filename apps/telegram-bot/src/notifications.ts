import { Bot } from 'grammy';
import { eq } from 'drizzle-orm';
import { type Db } from '@helm-pilot/db/client';
import { workspaceMembers, users } from '@helm-pilot/db/schema';
import { type BotContext } from './types.js';

export class NotificationService {
  constructor(private readonly bot: Bot<BotContext>, private readonly db: Db) {}

  /**
   * Broadcast a message to all members of a workspace.
   */
  async notifyWorkspace(workspaceId: string, message: string, markup?: any) {
    const members = await this.db
      .select({
        telegramId: users.telegramId,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(workspaceMembers.userId, users.id))
      .where(eq(workspaceMembers.workspaceId, workspaceId));

    const promises = members.map((m) => {
      if (m.telegramId) {
        return this.bot.api.sendMessage(m.telegramId, message, {
          parse_mode: 'Markdown',
          reply_markup: markup,
        }).catch((e) => {
          console.error(`Failed to notify ${m.telegramId}:`, e.message);
        });
      }
      return Promise.resolve();
    });

    await Promise.allSettled(promises);
  }

  /**
   * Send a specific push notification for an approval block.
   */
  async requestApproval(workspaceId: string, approvalId: string, actionText: string, reason: string) {
    const message = `*Approval Required*\n\nAction: ${actionText}\nReason: ${reason}`;
    const keyboard = {
      inline_keyboard: [
        [
          { text: 'Approve', callback_data: `approve:${approvalId}` },
          { text: 'Reject', callback_data: `reject:${approvalId}` },
        ],
      ],
    };

    await this.notifyWorkspace(workspaceId, message, keyboard);
  }

  /**
   * Phase 13 (Track B) — notify the workspace that a connector needs
   * re-auth after the background refresh worker hit the permanent-failure
   * threshold (3 consecutive failures or an immediate invalid_grant).
   */
  async requestReauth(workspaceId: string, connectorName: string) {
    const pretty = connectorName.charAt(0).toUpperCase() + connectorName.slice(1);
    const message =
      `*Reconnect ${pretty}*\n\n` +
      `The ${pretty} connector stopped refreshing. Open HELM Pilot and ` +
      `reconnect via Settings → Connectors to resume automated actions.`;
    await this.notifyWorkspace(workspaceId, message);
  }
}
