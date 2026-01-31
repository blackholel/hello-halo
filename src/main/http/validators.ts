/**
 * HTTP Request Validators - Input validation using Zod
 *
 * Validates all user input to prevent injection attacks
 * and ensure data integrity.
 */

import { z } from 'zod'

/**
 * Login token validation schema
 * Token must be exactly 6 numeric digits
 */
export const loginTokenSchema = z.object({
  token: z
    .string({
      required_error: 'Token is required',
      invalid_type_error: 'Token must be a string'
    })
    .length(6, 'Token must be exactly 6 digits')
    .regex(/^\d{6}$/, 'Token must contain only digits')
})

export type LoginTokenInput = z.infer<typeof loginTokenSchema>

/**
 * Validate login token input
 * @returns SafeParseReturnType with success/error
 */
export function validateLoginToken(input: unknown): z.SafeParseReturnType<unknown, LoginTokenInput> {
  return loginTokenSchema.safeParse(input)
}
