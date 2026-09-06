/** UTF-8 byte length of a JSON string including its surrounding quotes. */
export function jsonStringBytes(value) {
    let bytes = 2;
    for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index);
        if (code < 0x80) {
            if (code < 0x20)
                bytes += code === 8 || code === 9 || code === 10 || code === 12 || code === 13 ? 2 : 6;
            else
                bytes += code === 34 || code === 92 ? 2 : 1;
        }
        else if (code < 0x800)
            bytes += 2;
        else if (code >= 0xd800 && code <= 0xdfff) {
            const next = value.charCodeAt(index + 1);
            if (code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
                bytes += 4;
                index++;
            }
            else
                bytes += 6; // JSON escapes isolated UTF-16 surrogates.
        }
        else
            bytes += 3;
    }
    return bytes;
}
