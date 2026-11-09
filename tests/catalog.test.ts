import { describe, expect, it } from 'vitest';
import { Catalog, imageUrl, type CatalogFile } from '../src/core/catalog.ts';
import file from '../public/catalog/devicetypes.json';

const cat = new Catalog(file as unknown as CatalogFile);

describe('device type catalog', () => {
  it('normalises manufacturer names', () => {
    expect(cat.maker('cisco')).toBe('Cisco');
    expect(cat.maker('Hewlett Packard Enterprise')).toBe('HPE');
    expect(cat.maker('Palo Alto')).toBe('Palo Alto Networks');
    expect(cat.maker('Nobody Inc')).toBeUndefined();
  });

  it('finds a model by name, part number or loose spelling', () => {
    expect(cat.search('Cisco', 'Catalyst 9200L-48T-4X')[0].slug).toBe('cisco-c9200l-48t-4x');
    expect(cat.search('Cisco', 'C9200L-48T-4X')[0].slug).toBe('cisco-c9200l-48t-4x');
    expect(cat.search('cisco', 'c9200l48t4x')[0].slug).toBe('cisco-c9200l-48t-4x');
    expect(cat.search('', 'N9K-C93180YC-FX3')[0].manufacturer).toBe('Cisco');
  });

  it('links exact matches only', () => {
    const t = cat.exact('Cisco', 'C9200L-48T-4X');
    expect(t?.uHeight).toBe(1);
    expect(t?.front).toBe('Cisco/cisco-c9200l-48t-4x.front.png');
    expect(cat.exact('Cisco', 'C9200')).toBeUndefined();
    expect(cat.exact('Cisco', 'UCS X9508 Chassis')?.slug).toBe('cisco-ucs-x9508');
    expect(cat.exact('', '', 'cisco-c9200l-48t-4x')?.model).toBe('Catalyst 9200L-48T-4X');
  });

  it('builds pinned, encoded image URLs', () => {
    expect(imageUrl('abc', 'Palo Alto Networks/x.front.png')).toBe(
      'https://raw.githubusercontent.com/netbox-community/devicetype-library/abc/elevation-images/Palo%20Alto%20Networks/x.front.png'
    );
  });
});
