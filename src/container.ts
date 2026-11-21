/**
 * Minimal dependency-injection container.
 *
 * TypeScript has no parameter metadata without `emitDecoratorMetadata` plus a
 * `reflect-metadata` polyfill, and this backend is compiled to a single Bun
 * binary, so dependencies are declared explicitly with `inject: [...]` on the
 * decorators. The container therefore only has to resolve tokens, detect
 * cycles and build each singleton once.
 */

import type { AbstractConstructor, Constructor } from "./types.ts";

/** A token for something that has no runtime value to use as its identity. */
export class InjectionToken<T> {
  constructor(readonly description: string) {}

  toString(): string {
    return `InjectionToken(${this.description})`;
  }
}

export type Token<T = any> =
  | Constructor<T>
  | AbstractConstructor<T>
  | InjectionToken<T>;

type ValueProvider<T = any> = { kind: "value"; token: Token<T>; value: T };
type ClassProvider<T = any> = {
  kind: "class";
  token: Token<T>;
  ctor: Constructor<T>;
  inject: Token[];
};
type FactoryProvider<T = any> = {
  kind: "factory";
  token: Token<T>;
  factory: (container: Container) => T;
};

type Provider = ValueProvider | ClassProvider | FactoryProvider;

export class Container {
  private readonly providers = new Map<Token, Provider>();
  private readonly instances = new Map<Token, unknown>();
  private readonly stack: Token[] = [];

  registerValue<T>(token: Token<T>, value: T): this {
    this.assertUnregistered(token);
    this.providers.set(token, { kind: "value", token, value });
    return this;
  }

  registerClass<T>(token: Token<T>, ctor: Constructor<T>, inject: Token[] = []): this {
    this.assertUnregistered(token);
    this.providers.set(token, { kind: "class", token, ctor, inject });
    return this;
  }

  registerFactory<T>(token: Token<T>, factory: (container: Container) => T): this {
    this.assertUnregistered(token);
    this.providers.set(token, { kind: "factory", token, factory });
    return this;
  }

  has(token: Token): boolean {
    return this.providers.has(token);
  }

  resolve<T>(token: Token<T>): T {
    return this.resolveToken(token) as T;
  }

  private resolveToken(token: Token): unknown {
    if (this.instances.has(token)) return this.instances.get(token);

    const provider = this.providers.get(token);
    if (!provider) {
      const requiredBy = this.stack.at(-1);
      const suffix = requiredBy ? ` (required by ${describeToken(requiredBy)})` : "";
      throw new Error(`cqrs: no provider registered for ${describeToken(token)}${suffix}`);
    }

    if (this.stack.includes(token)) {
      const cycle = [...this.stack, token].map(describeToken).join(" -> ");
      throw new Error(`cqrs: circular dependency: ${cycle}`);
    }

    this.stack.push(token);
    try {
      const instance = this.build(provider);
      this.instances.set(token, instance);
      return instance;
    } finally {
      this.stack.pop();
    }
  }

  private build(provider: Provider): unknown {
    switch (provider.kind) {
      case "value":
        return provider.value;
      case "factory":
        return provider.factory(this);
      case "class": {
        const dependencies = provider.inject.map((dependency) => this.resolveToken(dependency));
        return new provider.ctor(...dependencies);
      }
    }
  }

  private assertUnregistered(token: Token): void {
    if (this.providers.has(token)) {
      throw new Error(`cqrs: provider already registered for ${describeToken(token)}`);
    }
  }
}

function describeToken(token: Token): string {
  if (token instanceof InjectionToken) return token.toString();
  if (typeof token === "function") return token.name || "<anonymous class>";
  return String(token);
}
