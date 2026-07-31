import type {
  CompiledCreativeRequest,
  CreativeRequestCompileInput,
} from './creativeRequestCompiler';

export async function requestCreativeRequestCompilation(
  input: CreativeRequestCompileInput,
): Promise<CompiledCreativeRequest> {
  const response = await fetch('/api/local/creative-request/compile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await response.json().catch(() => undefined) as
    | CompiledCreativeRequest
    | { error?: string }
    | undefined;
  if (!response.ok) {
    throw new Error(
      body && 'error' in body && body.error
        ? body.error
        : `Creative Request Compiler failed (${response.status}).`,
    );
  }
  if (!body || !('schemaVersion' in body) || body.schemaVersion !== 1) {
    throw new Error('Creative Request Compiler returned an invalid response.');
  }
  return body;
}
