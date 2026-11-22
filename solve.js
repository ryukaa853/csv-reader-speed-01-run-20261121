// csv-reader-fast: a fast drop-in for csv-reader 1.0.0, make.fun's own CSV
// reader. It returns exactly the reference's answer for every input, but
// reads the text with indexOf scans and whole-field slices instead of walking
// one character at a time, and takes a per-record fast path whenever a record
// holds no quote and no stray CR: then it is just its line split on commas.
//
// Reading policy (the reference's, reproduced exactly):
// - a U+FEFF at the very start of the text is dropped;
// - a record ends at LF or CRLF, and a line left with no characters is no
//   record (a line holding only stray CRs leaves no record, but keeps its
//   stray_cr errors);
// - outside a quoted field a CR not followed by LF is dropped, with a
//   stray_cr error, and does not end the line;
// - a field that opens with a quote runs to the next quote that is not
//   doubled; "" inside it is one quote, and each CRLF or lone CR inside it
//   reads as LF; what follows its closing quote, up to the next comma or
//   line break, is appended as it stands (quote_junk when the field ends, if
//   anything was appended); a quote that never closes is a literal character
//   and the text after it is read again as unquoted (unterminated_quote);
// - a quote inside an unquoted field is a literal character; fields stay
//   strings, never trimmed or converted;
// - columns is the first record when header is true, else null; rows holds
//   the records after it (every record when header is false), each padded
//   with "" (short_row, with fields: its field count) or cut (long_row, with
//   extra: the cut fields) to the first record's width;
// - each error is {code, line, row}, in the order met, a field's quote_junk
//   when the field ends and a record's short_row or long_row when the record
//   ends; line is the 1-based line its record starts on, counting every LF,
//   CRLF and lone CR inside a quoted field, and row is its record's index in
//   rows (null for the header).
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to
// the next.

/** A CR or CRLF inside a quoted field becomes one LF. */
const QUOTED_CR = /\r\n?/g;

/** Stray CRs, dropped one by one. */
const STRAY_CR = /\r/g;

/**
 * `s` with every CR dropped, one stray_cr error pushed per CR dropped.
 * Every CR in `s` is stray: a CR that ends a CRLF is cut before this runs.
 */
function dropStray(s, errors, line, row) {
  let count = 0;
  let at = -1;
  while ((at = s.indexOf('\r', at + 1)) !== -1) count += 1;
  for (let i = 0; i < count; i++) errors.push({ code: 'stray_cr', line, row });
  return s.replace(STRAY_CR, '');
}

/** What keeps a record off the fast path: a quote or a stray CR. */
const DIRTY = /["\r]/;

/**
 * csv-reader 1.0.0's answer for one case's input, {text, header}:
 * {columns, rows, errors}.
 */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    let fields;
    let quoted = false;

    // Fast path: a record whose line holds no quote and no stray CR is its
    // line split on commas. The line ends at the next LF, or at the end of
    // the text; a CR right before that LF is the CRLF ending, not a stray.
    const lineEnd = text.indexOf('\n', pos);
    const end = lineEnd === -1 ? n : lineEnd;
    const segEnd = lineEnd !== -1 && end > pos && text.charCodeAt(end - 1) === 13 ? end - 1 : end;
    if (segEnd > pos) {
      const seg = text.slice(pos, segEnd);
      if (!DIRTY.test(seg)) {
        fields = seg.split(',');
        pos = lineEnd === -1 ? n : lineEnd + 1;
        if (lineEnd !== -1) line += 1;
      }
    }

    if (fields === undefined) {
      // Slow path: read the record field by field.
      fields = [];
      // How the last field ended: 0 at a comma (the record goes on), 1 at a
      // line break, 2 at the end of the text (the record ends).
      let ended = 0;
      do {
        let value;
        let junkCheck = false;
        if (text.charCodeAt(pos) === 34) {
          // A field that opens with a quote.
          quoted = true;
          const open = pos;
          let scan = pos + 1;
          let close = -1;
          let doubled = false;
          for (;;) {
            const q = text.indexOf('"', scan);
            if (q === -1) break;
            if (text.charCodeAt(q + 1) === 34) {
              doubled = true;
              scan = q + 2;
              continue;
            }
            close = q;
            break;
          }
          if (close === -1) {
            // The quote never closes: it is a literal character, and the
            // text after it is read again as unquoted.
            errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
            pos = open + 1;
            value = '"';
          } else {
            let content = text.slice(open + 1, close);
            // Count the line breaks inside the quotes (each LF, CRLF and
            // lone CR one line) and note whether any CR needs normalising.
            let hasCR = false;
            let k = 0;
            for (;;) {
              const nl = content.indexOf('\n', k);
              const cr = content.indexOf('\r', k);
              if (nl === -1 && cr === -1) break;
              if (cr !== -1 && (nl === -1 || cr < nl)) {
                hasCR = true;
                line += 1;
                k = cr + 1;
                if (content.charCodeAt(cr + 1) === 10) k = cr + 2;
              } else {
                line += 1;
                k = nl + 1;
              }
            }
            if (hasCR) content = content.replace(QUOTED_CR, '\n');
            if (doubled) content = content.replaceAll('""', '"');
            value = content;
            pos = close + 1;
            if (pos >= n) {
              fields.push(value);
              ended = 2;
              continue;
            }
            const c = text.charCodeAt(pos);
            if (c === 44) {
              fields.push(value);
              pos += 1;
              ended = 0;
              continue;
            }
            if (c === 10) {
              fields.push(value);
              pos += 1;
              line += 1;
              ended = 1;
              continue;
            }
            if (c === 13 && text.charCodeAt(pos + 1) === 10) {
              fields.push(value);
              pos += 2;
              line += 1;
              ended = 1;
              continue;
            }
            // What follows the closing quote is appended as it stands, up
            // to the next comma or line break.
            junkCheck = true;
          }
        } else {
          quoted = false;
          value = '';
        }

        // Reads unquoted characters onto `value` up to the next comma or
        // line break: a CR not followed by LF is dropped (stray_cr).
        // `added` counts the characters kept, for the quote_junk check.
        // The field runs to the next comma, or to the next line break when
        // no comma is left; only the sliced segment is searched for a line
        // break or a stray CR, never the whole text.
        let added = 0;
        const comma = text.indexOf(',', pos);
        let end;
        let endKind; // 0 comma, 1 line break, 2 end of text
        if (comma === -1) {
          const lf = text.indexOf('\n', pos);
          if (lf === -1) {
            end = n;
            endKind = 2;
          } else {
            end = lf;
            endKind = 1;
          }
        } else {
          end = comma;
          endKind = 0;
        }
        let seg = text.slice(pos, end);
        if (endKind === 0) {
          const nlAt = seg.indexOf('\n');
          if (nlAt !== -1) {
            // A line break inside the segment ends the field here, not at
            // the comma; a CR right before it is the CRLF ending.
            let head = nlAt > 0 && seg.charCodeAt(nlAt - 1) === 13 ? seg.slice(0, nlAt - 1) : seg.slice(0, nlAt);
            if (head.indexOf('\r') !== -1) head = dropStray(head, errors, recordLine, recordRow);
            value += head;
            added += head.length;
            pos = pos + nlAt + 1;
            line += 1;
            ended = 1;
          } else {
            if (seg.indexOf('\r') !== -1) seg = dropStray(seg, errors, recordLine, recordRow);
            value += seg;
            added += seg.length;
            pos = end + 1;
            ended = 0;
          }
        } else {
          // The segment runs to a line break or the end of the text; a CR
          // right at its end, before the LF, is the CRLF ending.
          if (endKind === 1 && seg.charCodeAt(seg.length - 1) === 13) seg = seg.slice(0, -1);
          if (seg.indexOf('\r') !== -1) seg = dropStray(seg, errors, recordLine, recordRow);
          value += seg;
          added += seg.length;
          if (endKind === 1) {
            pos = end + 1;
            line += 1;
            ended = 1;
          } else {
            pos = n;
            ended = 2;
          }
        }
        if (junkCheck && added > 0) {
          errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        }
        fields.push(value);
      } while (ended === 0);
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
