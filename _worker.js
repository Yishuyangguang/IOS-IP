/**
 * Apple ID 全量账号云端解析与变动同步引擎
 * 文件名: _worker.js
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. 账号全量数据 API
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
          return new Response(JSON.stringify({ success: false, error: `源站响应异常 (${resp.status})` }), {
            status: 502,
            headers: { "Content-Type": "application/json; charset=utf-8" }
          });
        }

        const html = await resp.text();
        const accounts = [];
        const seenAccounts = new Set();

        // 核心解析策略：以【地区】为锚点向后扫描剪贴板文本与更新时间
        const regionAnchorRegex = /【([^】]+)】/g;
        let match;

        while ((match = regionAnchorRegex.exec(html)) !== null) {
          const region = match[1].trim();
          const matchIndex = match.index;

          // 截取该锚点前后 1200 字符的 HTML 片段作为一个卡片作用域
          const scopeStart = Math.max(0, matchIndex - 300);
          const scopeEnd = Math.min(html.length, matchIndex + 1200);
          const scopeHtml = html.substring(scopeStart, scopeEnd);

          // 提取剪贴板属性 (兼容 data-clipboard-text, data-text, onclick 等)
          const clipboardMatches = [];
          const clipRegex = /(?:data-clipboard-text|data-text|data-value)=["']([^"']+)["']/gi;
          let clipMatch;
          while ((clipMatch = clipRegex.exec(scopeHtml)) !== null) {
            clipboardMatches.push(clipMatch[1].trim());
          }

          // 如果属性中未找到，匹配 onclick="copy('xxx')"
          if (clipboardMatches.length === 0) {
            const onclickRegex = /onclick=["'][^"']*(?:copy|Copy)\(['"]([^'"]+)['"]\)/gi;
            let ocMatch;
            while ((ocMatch = onclickRegex.exec(scopeHtml)) !== null) {
              clipboardMatches.push(ocMatch[1].trim());
            }
          }

          let account = "";
          let password = "";

          if (clipboardMatches.length >= 2) {
            account = clipboardMatches[0];
            password = clipboardMatches[1];
          } else if (clipboardMatches.length === 1) {
            account = clipboardMatches[0];
          }

          // 邮箱格式兜底探测
          if (!account || !account.includes("@")) {
            const emailDetect = scopeHtml.match(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/);
            if (emailDetect && !emailDetect[0].includes("***")) {
              account = emailDetect[0];
            }
          }

          // 提取更新时间
          const timeDetect = scopeHtml.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2}(?::\d{1,2})?/);
          const updateTime = timeDetect ? timeDetect[0] : "刚刚更新";

          // 账号有效性校验与去重
          if (account && !seenAccounts.has(account)) {
            seenAccounts.add(account);
            accounts.push({
              region: region || "未知",
              account: account,
              password: password || "点击复制获取",
              update_time: updateTime
            });
          }
        }

        // 若锚点未匹配到任何数据，执行全文档备用扫描
        if (accounts.length === 0) {
          const allClips = [...html.matchAll(/(?:data-clipboard-text|data-text)=["']([^"']+)["']/gi)].map(m => m[1].trim());
          for (let i = 0; i < allClips.length; i += 2) {
            const acc = allClips[i];
            const pwd = allClips[i + 1] || "未提供";
            if (acc && acc.includes("@") && !seenAccounts.has(acc)) {
              seenAccounts.add(acc);
              accounts.push({
                region: "共享节点",
                account: acc,
                password: pwd,
                update_time: "最新可用"
              });
            }
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
            "Cache-Control": "public, max-age=60, stale-while-revalidate=180" // 缓存 60 秒，保证源站变动时及时刷新
          }
        });

      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        });
      }
    }

    // 2. 静态资源托管回退
    if (env.ASSETS) {
      return await env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  }
};
