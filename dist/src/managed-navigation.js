export const MOC_BEGIN = '%% MCPVault MOC BEGIN %%';
export const MOC_END = '%% MCPVault MOC END %%';
/** Exact offsets; markers in matching code fences are inert examples. */
export function managedNavigationRegion(content) {
    let fence = '';
    let length = 0;
    let offset = 0;
    let start = -1;
    let end = -1;
    for (const raw of content.split(/(?<=\n)/)) {
        const line = raw.replace(/\r?\n$/, '');
        const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
        if (match) {
            if (!fence) {
                fence = match[1][0];
                length = match[1].length;
            }
            else if (fence === match[1][0] && match[1].length >= length && !match[2].trim())
                fence = '';
        }
        else if (!fence && line === MOC_BEGIN) {
            if (start !== -1)
                throw new Error('Duplicate managed MOC markers');
            start = offset;
        }
        else if (!fence && line === MOC_END) {
            if (start === -1 || end !== -1)
                throw new Error('Malformed managed MOC markers');
            end = offset + raw.length;
        }
        offset += raw.length;
    }
    if ((start === -1) !== (end === -1))
        throw new Error('Unclosed managed MOC region');
    return start < 0 ? undefined : { start, end, text: content.slice(start, end) };
}
