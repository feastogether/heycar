# 即時通訊與司機班表快速編輯

日期：2026-11-24（Asia/Taipei），基準 c821e61；資產版本 20261124-4。

## 使用方式

- 單擊每日格子開啟備註／顏色編輯，頂部提供「出車」「休假」。保養／調胎標籤本身仍開原排程表單。
- 「出車」加上出車備註並移除該日休假；「休假」同步既有報班資料，保留其他日期。既有備註除開頭的快捷狀態字以外保留。遇未完成保養／調胎先在同一編輯框確認，不自動取消保養。
- 區域讀取駕駛資料，顯示在姓名下；雙擊姓名可改班表位置（最多80字，跨月份共用），不改駕駛的區域／地址。位置獨立存放、revision CAS 與 audit。
- 車牌下顯示該車輛 model 車款，沒有資料顯示 —；讀取現有有效駕駛歷程及正式指派，不重新配車。
- 按「範圍選取」後選起點，Shift＋點擊選終點；方向鍵移動、Shift＋方向鍵延伸。可用複製／貼上按鈕或 Ctrl+C／Ctrl+V。貼上先預覽，再確認；一次最多200格，同一月份且不得超出目前篩選的司機／日期。
- 內部複製包含備註、格子顏色與休假狀態；外部 Excel 接受 Tab／換行矩形文字，正確解析引號內換行、Tab 及雙引號跳脫（引號不完整拒絕貼上），「出車」「休假」才同步休假，其餘文字保留目標格休假／顏色。純文字複製會把備註內的換行轉空格，內部同內容貼上仍保留原多行備註。剪貼暫存按登入身分隔離，不寫 localStorage。
- 底部各日期統計目前篩選司機的休假總數，待審另列小字，退回申請不算休假。原申請 pending 不因單日快速編輯而整月核准；退回的報班需先重新審核，不能用快捷操作悄悄改成同意。

## 資料與 API

新增 migration 20261124010000_roster_quick_edit：driver_roster_profiles、driver_roster_profile_audit、driver_roster_profile_save、driver_roster_cells_save、driver_roster_details；擴充既有唯讀車牌投影加入 model，stamp 納入位置／區域／車款變化。

save_driver_roster_profile／save_driver_roster_cells 都沿用 driverReporting 後端授權，司機不能呼叫。API 入口硬編碼分派同步更新。只查詢既有 id,region 與精簡車牌／model，不恢復全量駕駛證件下載。

批次儲存先鎖月份、依 driver/date 排序鎖格子，檢查所有 note revision／leave revision，再套用休假及備註／顏色。任一格衝突全部回滾，沿用既有報班 CAS 與 audit；其他日期及原審核狀態保留。只填出車、沒有實際休假變化時不新建一份「已報班」月申請。既有保養排程、工單、駕駛歷程、保單與車輛主檔不寫入。

原生 dialog 的確認層放在同一 top layer，避免 div 確認框被擋在後面；等待儲存時鎖按鈕，Enter 開格子時阻止同次鍵盤事件意外觸發快捷按鈕。

## 即時通訊

固定桌面聊天面板、名單、訊息及輸入區高度分配，空群組或少量訊息不再使內容區塌縮；手機保留單欄切換及返回聯絡人。

聯絡人晚到時同步恢復輸入／送出可用性，保留傳送中鎖定。群組訊息載入失敗改顯示局部錯誤並保留快取內容；缺少群組名單欄位不清空原資料；群組成員 metadata 缺漏防止 length／map／filter 異常。快速切換時忽略已離開對話的錯誤與已讀後續動作，避免舊請求污染新對話。資料庫聊天記錄／成員權限／已讀游標／@ 與增量輪詢機制保持原流程。

## 驗證與發布保護

- test-roster-quick-edit.cjs：實際 SQL 位置 CAS、區域／車款投影、備註／顏色／休假原子批次、任一格過期全部回滾、重複／跨月／超量／司機權限拒絕；出車不偽造月報、待審申請保留狀態及原休假。
- test-roster-quick-edit-ui.cjs：Edge／WebKit；雙擊位置、單擊快捷、同步統計、Excel TSV 貼上與重載；320／390／768／1440px，橫移後前三個固定欄不重疊。
- test-chat-layout-ui.cjs：Edge／WebKit 四種寬度；聯絡人／群組往返、晚到輸入狀態、錯誤後保留訊息與聯絡人、恢復連線、輸入區完整可見。
- test-chat-groups.cjs、test-driver-roster.cjs、test-operation-action-routing.cjs、test-workspace-loading.cjs 既有權限／資料範圍與增量路由回歸。
- test-roster-colors-ui.cjs、test-roster-preferences-ui.cjs：原顏色／保養編輯／取消、52位司機完整展開、單一頁面垂直捲動、排序與顯示偏好。
- 正式前備份73張 public 表與802筆 Storage metadata，在 PGlite 套用新 migration 並比對原欄位筆數／雜湊；正式採 repeatable-read 增量交易，原資料校驗不符則整筆回滾。metadata 不等於附件實體備份。
- 正式驗證只讀班表／單筆排程，檢查新 RPC ACL 與 migration；新 action 只送格式錯誤／空批次確認會拒絕，未提交真實業務表單，臨時 Session 精確移除。

2026-11-24 正式發布：前端 86f9f6d2-f059-4a86-b24c-7e7b1f22b742、資產 20261124-4；六檔雜湊與測試來源一致。data-api 與增量 migration 已發布；R2 服務未變。正式唯讀驗證通過，臨時檢查 Session 已清除。
