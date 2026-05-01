// Fixture for callGraph.test.ts: 5 function-like nodes, 3 calls.
// greet  -> helper          (function -> function)
// sayHi  -> greet            (arrow    -> function)
// Service.run -> Service.runInner (method -> method via this)

export function greet(name: string): string {
  return helper(name);
}

const sayHi = (name: string) => {
  return greet(name);
};

class Service {
  public run(name: string): string {
    return this.runInner(name);
  }

  private runInner(name: string): string {
    return name;
  }
}

function helper(input: string): string {
  return input.toUpperCase();
}

export { sayHi, Service };
