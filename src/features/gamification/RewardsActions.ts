import { useMemo } from 'react'
import { recordError } from '@/app/reportError'
import {
  InsufficientXpError,
  RewardUnavailableError,
  archiveReward,
  createReward,
  redeemReward,
  reorderRewards,
  unarchiveReward,
  updateReward,
  type RewardInput,
  type RewardPatch,
} from '@/db/repos/rewards'
import { getXpSummary } from '@/db/repos/xp'
import type { ID, Reward } from '@/db/types'
import { formatXpNumber } from '@/logic/rewards'
import { useToast } from '@/ui/Toast'

export interface RewardActions {
  /** Buys the reward. Celebrates with a toast whose Undo refunds it; a shortfall is a gentle note, not an error. */
  redeem: (reward: Reward) => Promise<boolean>
  /** Creates a reward; resolves `true` when it was saved. */
  create: (input: RewardInput) => Promise<boolean>
  /** Saves an inline edit; resolves `true` when it was saved. */
  save: (id: ID, patch: RewardPatch) => Promise<boolean>
  archive: (reward: Reward) => Promise<void>
  restore: (reward: Reward) => Promise<void>
  /** Saves a new shop order; resolves `true` when it was saved. */
  reorder: (ids: ID[]) => Promise<boolean>
}

/** Every write the shop makes, with the toast that goes with it. Failures are reported, never thrown. */
export function useRewardActions(): RewardActions {
  const toast = useToast()
  return useMemo<RewardActions>(() => {
    const failed = (error: unknown, where: string, message: string): void => {
      recordError(error, `rewards.${where}`)
      toast.error(message, { description: 'Your XP is unchanged. Try again.' })
    }

    return {
      async redeem(reward) {
        try {
          const { redemption, undo } = await redeemReward(reward.id, Date.now())
          const { balance } = await getXpSummary(redemption.day)
          toast.xp(`Enjoy it! · −${formatXpNumber(redemption.price)} XP`, {
            description: `${redemption.rewardTitle} is yours. ${formatXpNumber(balance)} XP left.`,
            undo,
          })
          return true
        } catch (error) {
          if (error instanceof InsufficientXpError) {
            toast.show({
              title: 'Not quite yet',
              description: `${formatXpNumber(error.shortBy)} XP to go for ${reward.title}.`,
            })
          } else if (error instanceof RewardUnavailableError) {
            toast.show({ title: 'That reward is no longer in the shop' })
          } else {
            failed(error, 'redeem', 'Couldn’t redeem that')
          }
          return false
        }
      },

      async create(input) {
        try {
          await createReward(input)
          return true
        } catch (error) {
          failed(error, 'create', 'Couldn’t add that reward')
          return false
        }
      },

      async save(id, patch) {
        try {
          await updateReward(id, patch)
          return true
        } catch (error) {
          failed(error, 'save', 'Couldn’t save that change')
          return false
        }
      },

      async archive(reward) {
        try {
          const { undo } = await archiveReward(reward.id)
          toast.show({
            title: `${reward.title} archived`,
            description: 'Your redemption history keeps it.',
            undo,
          })
        } catch (error) {
          failed(error, 'archive', 'Couldn’t archive that reward')
        }
      },

      async restore(reward) {
        try {
          await unarchiveReward(reward.id)
          toast.success(`${reward.title} is back in the shop`)
        } catch (error) {
          failed(error, 'restore', 'Couldn’t restore that reward')
        }
      },

      async reorder(ids) {
        try {
          await reorderRewards(ids)
          return true
        } catch (error) {
          failed(error, 'reorder', 'Couldn’t save the new order')
          return false
        }
      },
    }
  }, [toast])
}
