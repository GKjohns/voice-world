/**
 * Read an NDJSON response line by line, handing each parsed line to `onLine`. A line that doesn't parse
 * (or whose handler throws) is skipped, with a warning under `tag` when one is given. Throws on a network
 * failure mid-stream.
 */
export async function readNdjson<T>(res: Response, onLine: (ev: T) => void, tag?: string): Promise<void> {
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  const flush = (line: string) => {
    if (!line.trim()) return
    try {
      onLine(JSON.parse(line) as T)
    } catch (err) {
      if (tag) console.warn(`[${tag}] bad line`, line.slice(0, 120), err)
    }
  }
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl = buf.indexOf('\n')
    while (nl >= 0) {
      flush(buf.slice(0, nl))
      buf = buf.slice(nl + 1)
      nl = buf.indexOf('\n')
    }
  }
  flush(buf)
}
