import { createContext, useContext, type Context } from 'react'

/**
 * Create a React context plus a hook that throws a clear error when used outside its provider.
 * `name` is the provider's base name: the hook message reads
 * `use<Name> must be used within a <Name>Provider`.
 */
export function createSafeContext<T>(name: string): [Context<T | null>, () => T] {
  const Ctx = createContext<T | null>(null)
  const useSafeContext = (): T => {
    const value = useContext(Ctx)
    if (!value) throw new Error(`use${name} must be used within a ${name}Provider`)
    return value
  }
  return [Ctx, useSafeContext]
}
