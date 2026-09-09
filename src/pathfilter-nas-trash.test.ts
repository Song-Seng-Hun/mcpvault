import {describe,it,expect} from 'vitest';
import {PathFilter} from './pathfilter.js';

describe('NAS recycled documents remain outside the live vault',()=>{
  const filter=new PathFilter();
  it.each([
    'Network Trashes Folder',
    'Network Trashes Folder/Inbox/deleted.md',
    'network trashes folder/Community/deleted.md',
    'project/NETWORK TRASHES FOLDER/deleted.md',
    'project\\Network Trashes Folder\\deleted.md',
    'Network Trashes Folder./deleted.md',
  ])('denies direct access and listing: %s',p=>{
    expect(filter.isAllowed(p)).toBe(false);
    expect(filter.isAllowedForListing(p)).toBe(false);
  });
  it('does not hide similarly named ordinary notes',()=>{
    expect(filter.isAllowed('Network Trashes Folder.md')).toBe(true);
    expect(filter.isAllowed('Network Trashes Folder Guide/note.md')).toBe(true);
  });
});
