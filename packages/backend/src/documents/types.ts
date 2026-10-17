export interface Material {
  id: string; url: string; hash: string; fetchedAt: string; contentType: string;
  blocks: Array<{ id: string; text: string }>;
  links: Array<{ url: string; title: string }>; images: string[];
}
