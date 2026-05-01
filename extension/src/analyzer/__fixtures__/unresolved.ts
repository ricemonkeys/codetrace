// Negative fixture: receivers that cannot be statically attributed must NOT
// produce edges to unrelated methods that share a name.
// Asserted in callGraph.test.ts.

class Service {
  run(): string {
    return 'service';
  }
}

class Worker {
  run(): string {
    return 'worker';
  }
}

// Param receiver: 'obj' is untyped here, so the call site below is ambiguous.
function caller(obj: { run(): string }): string {
  return obj.run();
}

// Return-value receiver: also unresolvable from a single-file pass.
function build(): Service {
  return new Service();
}

function viaReturn(): string {
  return build().run();
}

export { Service, Worker, caller, viaReturn };
