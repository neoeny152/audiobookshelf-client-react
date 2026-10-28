'use server'

import { ActionResult, toActionResult } from '@/lib/actionResult'
import * as api from '@/lib/api'
import { CreateApiKeyPayload, CreateUpdateApiKeyResponse } from '@/types/api'
import { revalidatePath } from 'next/cache'

export async function deleteApiKey(apiKeyId: string): Promise<ActionResult> {
  const result = await toActionResult(() => api.deleteApiKey(apiKeyId))
  if (result.ok) {
    revalidatePath('/settings/api-keys')
  }
  return result
}

export async function createApiKey(payload: CreateApiKeyPayload): Promise<ActionResult<CreateUpdateApiKeyResponse>> {
  const result = await toActionResult(() => api.createApiKey(payload))
  if (result.ok) {
    revalidatePath('/settings/api-keys')
  }
  return result
}

export async function updateApiKey(apiKeyId: string, payload: CreateApiKeyPayload): Promise<ActionResult<CreateUpdateApiKeyResponse>> {
  const result = await toActionResult(() => api.updateApiKey(apiKeyId, payload))
  if (result.ok) {
    revalidatePath('/settings/api-keys')
  }
  return result
}
