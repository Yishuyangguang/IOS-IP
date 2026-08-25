/**
 * 实时同步与 Cloudflare XOR 邮箱逆向解密引擎
 * 文件名: _worker.js
 */

// 还原 Cloudflare data-cfemail 密文为真实邮箱地址
function decodeCfEmail(cfHex) {
  try {
    const key = parseInt(cfHex.substr(0, 2), 16);
    let email = "";
    for (let i = 2; i < cfHex.length; i += 2) {
      const b = parseInt(cfHex.substr(i, 2), 16);
      email += String.fromCharCode(b ^ key);
    }
    return email;
  } catch (e) {
    return "";
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. 实时抓取、解密与格式化接口
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
          return new Response(JSON.stringify({ success: false, error: `源站连接受阻 (${resp.status})` }), {
            status: 502,
            headers: { "Content-Type": "application/json; charset=utf-8" }
          });
        }

        const html = await resp.text();
        const accounts = [];
        const seen = new Set();

        // 将网页按照卡片容器切割
        const cardBlocks = html.split(/<div\s+class=["'][^"']*card\b[^"']*["']/i);

        for (let i = 1; i < cardBlocks.length; i++) {
          const card = cardBlocks[i];

          // 仅处理包含密码复制按钮的账号卡片
          if (!card.includes("copy(") && !card.includes("copyEmail")) continue;

          // 1. 提取地区（仅在标题区提取，排除说明文案中的【设置】）
          let region = "美国";
          const headerMatch = card.match(/<div class="card-header[^>]*>([\s\S]*?)<\/div>/i);
          if (headerMatch) {
            const regM = headerMatch[1].match(/【(.*?)】/);
            if (regM && regM[1].trim() !== "设置") {
              region = regM[1].trim();
            }
          }
          if (region === "美区") region = "美国";

          // 2. 提取账号：从 data-cfemail 解密
          let account = "";
          const cfMatch = card.match(/data-cfemail=["']([a-f0-9]+)["']/i) || card.match(/email-protection#([a-f0-9]+)/i);
          if (cfMatch) {
            account = decodeCfEmail(cfMatch[1]);
          } else {
            // 备选明文正则
            const emailM = card.match(/([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/);
            if (emailM && !emailM[1].includes("***")) {
              account = emailM[1];
            }
          }

          // 3. 提取密码：从 copy('PASSWORD') 提取
          let password = "";
          const pwdMatch = card.match(/copy\(['"]([^'"]+)['"]\)/i);
          if (pwdMatch) {
            password = pwdMatch[1].trim();
          }

          // 4. 提取更新时间
          let updateTime = "最新更新";
          const timeMatch = card.match(/账号更新：(?:<\/span>)?\s*([0-9\-\:\s]+)/i);
          if (timeMatch) {
            updateTime = timeMatch[1].trim();
          }

          if (account && password && !seen.has(account)) {
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
            "Cache-Control": "public, max-age=30, stale-while-revalidate=60" // 30秒短期缓存，确保源站变动及时生效
          }
        });

      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        });
      }
    }

    // 2. 静态页面回退托管
    if (env.ASSETS) {
      return await env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  }
};
