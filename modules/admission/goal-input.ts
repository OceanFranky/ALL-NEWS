import type { AdmissionSchool } from "@aihot/contracts/admission";

const normalize = (text: string) => text.trim().replace(/\s/g, "").replace(/（/g, "(").replace(/）/g, ")");
// Name resolution is limited to the verified directory; a URL never establishes a new trusted host.
export function schoolFromInput(input: string, schools: AdmissionSchool[]) {
  const text = normalize(input);
  let matches: AdmissionSchool[];
  if (/^https?:\/\//i.test(text)) {
    let url: URL;
    try { url = new URL(text); } catch { throw new Error("请填写完整的官网链接。"); }
    if (url.username || url.password || url.port) throw new Error("请使用不带账号、密码或特殊端口的公开官网链接。");
    matches = schools.filter(school => {
      if (!school.website) return false;
      const domain = new URL(school.website).hostname.replace(/^www\./, "");
      return url.hostname === domain || url.hostname.endsWith(`.${domain}`);
    });
  } else {
    matches = schools.filter(school => normalize(school.name) === text);
    if (!matches.length && text.length >= 2) matches = schools.filter(school => normalize(school.name).includes(text));
  }
  if (matches.length > 1) throw new Error(`请明确学校名称，例如：${matches.slice(0, 3).map(s => s.name).join("、")}。`);
  if (!matches.length) throw new Error("暂未匹配到已核验的院校，请从学校名称提示中选择；新学校需先核验官网归属。");
  return matches[0];
}
