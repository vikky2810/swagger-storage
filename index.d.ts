export type RequestHandler = (req: any, res: any, next: (err?: any) => void) => void

export interface SwaggerStorageSetupOptions {
  /** Overrides the token read from package.json's `swaggerStorage.token`. */
  swaggerStorageToken?: string
  customJs?: string | string[]
  customJsStr?: string | string[]
  customCss?: string
  customCssUrl?: string
  customfavIcon?: string
  customSiteTitle?: string
  swaggerOptions?: Record<string, unknown>
  explorer?: boolean
  [key: string]: unknown
}

/**
 * Drop-in replacement for swagger-ui-express's `serve` middleware array.
 * Also serves the swagger-storage browser bundle.
 */
export const serve: RequestHandler[]

/**
 * Drop-in replacement for swagger-ui-express's `setup(...)`. Same
 * signature, but wires in localStorage-backed request body persistence.
 */
export function setup(
  swaggerDoc?: Record<string, unknown>,
  opts?: SwaggerStorageSetupOptions,
  ...rest: unknown[]
): RequestHandler
