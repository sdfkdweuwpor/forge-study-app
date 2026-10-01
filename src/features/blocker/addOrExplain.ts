import { recordError } from '@/app/reportError'
import { BlocklistInputError } from '@/db/repos/blocker'

/**
 * Runs an "add" and turns its outcome into what the field shows: `null` when it worked, the message of
 * a rejected input (an unusable domain, a repeat), or a generic line for anything unexpected (which is
 * also recorded).
 */
export async function addOrExplain(
  add: () => Promise<unknown>,
  detail: string,
): Promise<string | null> {
  try {
    await add()
    return null
  } catch (e) {
    if (e instanceof BlocklistInputError) return e.message
    recordError(e, detail)
    return 'Couldn’t add that. Try again.'
  }
}
