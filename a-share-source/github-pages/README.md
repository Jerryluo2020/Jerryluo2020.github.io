# A股每日收盘版

网站、日线快照和浏览器分析全部部署在 GitHub Pages，不调用原 Sites 接口。

工作流 `.github/workflows/daily-market.yml` 每周一至五北京时间16:23启动，也支持 Actions 页面手动运行。GitHub 定时任务可能延迟；公开仓库长期无活动时定时任务可能暂停，请查看 Actions 状态。首次启用应将仓库 Settings → Pages → Source 设为 GitHub Actions。

数据由 GitHub Actions 直接从新浪/东方财富获取热力榜、腾讯获取前复权日线。每股最多640根日线，样本还需60日预热，页面显示可选历史起点。日线缺成交额和换手率，因此以五因子重分配权重评分。股票池来自新浪 hs_a；覆盖范围以当次供应商返回列表为准，不保证已退市股票完整。历史日期筛选存在存续偏差。

采用4路并发、每批至少间隔1秒；日线最多尝试2次，尊重Retry-After并指数退避。连续24只失败时停止请求，输出错误明细。每80只保存压缩快照检查点，同一交易日的后续尝试可恢复，避免重新请求已成功数据。诊断报告上传到Actions artifacts。池不完整、交易日历无效或日线成功率低于90%时整次发布失败，保留上次网站，不会把失败数据标记为今日完整数据。少量采集失败会披露并计入扫描失败。休市日依据指数实际日期标记。

日线按80只股票分片并gzip压缩，以内容哈希命名。浏览器后台线程读取快照并复用原有指标和评分算法，主页面显示计算进度、支持取消。当前页面固定使用同一版本快照，刷新页面获取新版本。首次全市场分析需要下载全部压缩日线；请使用支持 DecompressionStream 的现代浏览器。

本地构建：`pnpm exec vite build --config github-pages/vite.config.ts`。
采集：`node scripts/collect-snapshot.mjs ../github-pages-dist/data`。
测试：`node --experimental-strip-types scripts/test-snapshot.mjs`。

构建与采集成功后才上传并部署 Pages artifact，不提交每天的大体积数据到 Git 历史。GitHub 源码是持续维护来源；原 Sites 站点不再承担此版本的数据或计算请求。

测试发布：手动运行时勾选 test_mode，或测试提交包含 [test-snapshot] 标记。允许非零覆盖率的部分数据发布，页面明确标注测试及缺失数量。定时正式任务仍要求90%覆盖率。
