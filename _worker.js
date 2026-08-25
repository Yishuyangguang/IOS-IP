/**
 * 太阳 ios-IP - 真实账号解密与多国地区精准映射引擎
 * 文件名: _worker.js
 */

// Cloudflare 专属 XOR 邮箱逆向解密算法
function decodeCloudflareEmail(hexStr) {
  try {
    const key = parseInt(hexStr.substr(0, 2), 16);
    let email = "";
    for (let i = 2; i < hexStr.length; i += 2) {
      const charCode = parseInt(hexStr.substr(i, 2), 16) ^ key;
      email += String.fromCharCode(charCode);
    }
    return email;
  } catch (e) {
    return "";
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. API 动态抓取与解密接口
    if (url.pathname === "/api/appleid") {
      try {
        const targetUrl = "https://ccbaohe.com/appleID/";
        const resp = await fetch(targetUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Cache-Control": "no-cache"
          }
        });

        if (!resp.ok) {
          return new Response(JSON.stringify({ success: false, error: `源站状态异常 (${resp.status})` }), {
            status: 502,
            headers: { "Content-Type": "application/json; charset=utf-8" }
          });
        }

        const html = await resp.text();
        const accounts = [];
        const seen = new Set();

        // 按照每个卡片容器精准切片
        const cardBlocks = html.split(/<div\s+class=["'][^"']*card\b[^"']*["']/i);

        for (let i = 1; i < cardBlocks.length; i++) {
          const card = cardBlocks[i];

          // 排除广告卡片
          if (!card.includes("copy(") && !card.includes("copyEmail")) continue;

          // 1. 严格在当前卡片头部（card-header / h5）提取真实地区
          let region = "全球通用";
          const headerMatch = card.match(/<div class="card-header[^>]*>([\s\S]*?)<\/div>/i) || card.match(/<h5[^>]*>([\s\S]*?)<\/h5>/i);
          
          if (headerMatch) {
            const headerText = headerMatch[1];
            const regM = headerText.match(/【([^】]+)】/);
            if (regM) {
              const r = regM[1].trim();
              if (r !== "设置" && r !== "iCloud" && r !== "商城") {
                region = r;
              }
            }
          } else {
            // 备用：从整个卡片中提取排除掉“设置”的第一个方括号
            const allBrackets = [...card.matchAll(/【([^】]+)】/g)];
            for (const b of allBrackets) {
              const r = b[1].trim();
              if (r !== "设置" && r !== "iCloud" && r !== "商城") {
                region = r;
                break;
              }
            }
          }

          if (region === "美区") region = "美国";

          // 2. 真实账号解密 (还原 Cloudflare 加密邮箱)
          let account = "";
          const cfMatch = card.match(/data-cfemail=["']([a-f0-9]+)["']/i) || card.match(/email-protection#([a-f0-9]+)/i);
          if (cfMatch) {
            account = decodeCloudflareEmail(cfMatch[1]);
          } else {
            const emailM = card.match(/([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/);
            if (emailM && !emailM[1].includes("***")) {
              account = emailM[1];
            }
          }

          // 3. 真实密码提取 (从 copy('PASSWORD') 提取)
          let password = "";
          const pwdMatch = card.match(/copy\(['"]([^'"]+)['"]\)/i);
          if (pwdMatch) {
            password = pwdMatch[1].trim();
          }

          // 4. 更新时间提取
          let updateTime = "最新同步";
          const timeMatch = card.match(/账号更新：(?:<\/span>)?\s*([0-9\-\:\s]+)/i);
          if (timeMatch) {
            updateTime = timeMatch[1].trim();
          }

          // 去重并存储
          if (account && account.includes("@") && password && !seen.has(account)) {
            seen.add(account);
            accounts.push({
              region,
              account,
              password,
              update_time: updateTime
            });
          }
        }

        return new Response(JSON.stringify({
          success: true,
          total: accounts.length,
          accounts: accounts,
          syncTime: new Date().toISOString()
        }), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=30, stale-while-revalidate=60"
          }
        });

      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        });
      }
    }

    // 2. 静态页面回退
    if (env.ASSETS) {
      return await env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  }
};
