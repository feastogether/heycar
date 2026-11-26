# HEYCAR 專案交接文件

## 2026-11-26 置中淡入與電腦圖片品質（目前最新）

已發布Worker 5203cc8f-8deb-48b3-9928-b8be8cd057d4，app／login.css版本20261126-5。使用者最新要求登入框在畫面中間：電腦水平／內容區垂直置中，首次1000ms淡入並上移16px；boot同狀態不重建DOM，驗證／錯誤／標語／時段不重播，減少動態效果直接顯示。手機保留上照片下表單。桌面cover滿版、超寬70%取景；新detail WebP約0.5–0.6MB，手機小圖仍約78–85KB，Cloudflare每次只載對應時段。原生素材仍1672×941，非4K；改善細節與壓縮保真，不能宣稱解析度提高到4K。Edge/WebKit三時段十尺寸、動畫／A11Y／草稿／防連點、正式資產與七尺寸公開頁查核通過，無DB或後端變更。詳見docs/2026-11-26-centered-login-motion.md。

## 2026-11-26 登入桌面滿版修正（目前最新）

使用者回報contain兩側留白，桌面已改cover底部置中；2:1以上超寬螢幕表單靠上避免遮車，手機仍保留等比完整車隊與下方登入框。CSS版本20261126-4、app20261126-3；Worker 9c03bb49-5e38-449a-8446-54556e75ea91。Edge/WebKit三時段十尺寸與超寬螢幕驗證通過，無DB或後端變更。原登入發布文件內contain規格已被此修正取代。

## 2026-11-26 早／午／晚車隊登入頁（目前最新）

已依使用者確認預覽發布正式前端，Worker dff5a968-66d4-45cc-955a-cecff9820454，app／login.css版本20261126-3。保留白底原LOGO電腦174px／手機150px，登入框縮為340px、細中性邊框與陰影、無金色頂線；手機LOGO→完整車隊照→登入框。台灣時間05–12晨光／早安，12–18日光／午安，其餘晚景／晚安，標題完整為「早安／午安／晚安，歡迎回來」。六張新WebP分1672／840px，每次只載當下時段的一張，由Cloudflare提供，不增加Supabase圖片下載；原招募圖不改。單次交界計時器與返回頁面核對保留輸入，不新增API輪詢。後台login_slogans排序、停用、跳脫保留，延遲回應只更新文字區、不清掉輸入代碼。

Edge/WebKit三時段八尺寸、時區邊界、單圖下載、表單不遮車、手機鍵盤縮短視窗、防連點與既有auth audit測試通過；正式九資產SHA及四尺寸公開標語／布局核對通過，未送正式登入或業務表單。只部署前端，無DB／權限／登入驗證變更。詳見 docs/2026-11-26-time-aware-fleet-login.md。

## 2026-11-26 員工通知、報班清單與天氣對齊（目前最新）

已發布原 Cloudflare＋雲端 Supabase。首頁舊待處理框移除，上方改小鈴鐺＋數字、點開查看十類提醒；最高管理員在員工管理／通知管理設定各啟用員工可見類別。未設定員工預設無通知，最高管理員看全部；後端與有效功能權限交集，設定採 revision CAS、audit，不改員工權限。每類只回計數＋前五筆，60秒記憶快取、去重、不新增定時輪詢。駕照／驗車30天、保險60天含逾期；待配車按今日有效歷程、報班及借車去重，待工單只讀完成排程不自動建履歷。

兩個增量migration 20261126010000與20261126020000均已正式套用。後者修正正式PostgreSQL指派彙總逾時：只解析必要指派欄位一次，materialized CTE及單函式JIT off；不要移除或放寬全庫timeout。正式API十類提醒查核約282ms。82張原表／807筆Storage metadata副本演練及正式交易前後雜湊守衛通過，無原業務資料覆蓋；臨時session已清除，未送正式業務表單。

司機報班姓名／車牌／天數／審核及編輯同列，窄螢幕表格內橫滑；獨立司機班表不改。首頁單一天氣卡靠右、補掉移除待處理後的空白欄；上方天氣／鈴鐺／登出42px置中，400px以下保留後台天氣隱藏。Edge/WebKit六尺寸對齊及既有員工管理、費用、登入audit、路由測試通過。app等資產20261126-1、通知CSS20261126-2；前端Worker be751ab3-5394-4289-8a0e-5107b777519d，Storage Worker沿用。詳見 docs/2026-11-26-staff-notifications.md。下方舊首頁待辦布局紀錄為歷史，以本節為準。

## 2026-11-25 即時搜尋、司機共用介面與兩種追蹤（最新）

車輛／駕駛管理180ms即時篩選，保留focus／游標／中文組字，車商條件可組合，不新增每字查詢。司機前台集中使用assets/driver-ui.css tokens，規範見docs/DRIVER_UI_GUIDELINES.md：42px按鈕、8/12px圓角、16px表單輸入、共用卡片／視窗／照片及上傳狀態，僅body.is-driver-session生效。15功能四尺寸Edge/WebKit檢查，保養6張／車檢10張與補拍／草稿重整流程通過。

桃園抵達查詢後提供有聲／無聲追蹤，差別僅播報有無司機姓名；取消同樣遵守，無聲仍播報航班。R2 watch新增announceDriver，舊預設有姓名，舊重送不覆蓋明確模式，ETag防覆蓋且createdAt及事件保留。伺服器MP3與瀏覽器fallback共用格式，原5分鐘共用來源／5秒R2輕讀／8小時窗口／3分鐘消失不變。無DB結構／業務資料修改，現有追蹤與配對不批次改寫。正式七資產SHA及未授權拒絕驗證通過，未建立正式追蹤或廣播。資產20261125-7；前端a5b3ce59-1340-4f24-b9ea-85f171772a9b、Storage cef9c108-4637-4a09-8d0a-bd425af7f0a9。電視需重新整理以載入新fallback，原配對不變。詳見docs/2026-11-25-live-search-driver-ui-flight-modes.md。


## 2026-11-25 工單 BOM 關鍵字搜尋修復（最新）

車輛履歷按需載入遺漏 bom_parts／bom_packages，現已補齊；僅 serviceRecords view 且有 serviceRecords 權限可讀最小選項投影，不授予 BOM 管理寫入。搜尋目前保修廠優先但保留其他廠商，NFKC／空白／大小寫規格比對。正式唯讀確認97筆零件、4筆符合5w；乾淨登入直進履歷及帶入價格瀏覽器測試通過，正式 scoped API／前端雜湊核對通過。無 DB schema／業務資料修改。app版本20261125-6；Worker 1f2ffd56-eaae-4fee-bc0c-26c98900d658。


## 2026-11-25 保養完成與班表閱讀修復（最新）

已更新正式前端、data-api 與增量 migration `20261125040000_service_dashboard_details`。保養總覽操作固定兩欄；司機保養未完成／已完成分頁、歷史通知車牌由後端限定本人讀取，修配廠導航取廠商管理新 address。完成表單上傳轉圈／鎖定，內文可捲動而操作列保持可見；新儀表照片 slot=odometer，現在有工單6張／明確尚未有工單5張，舊完成不倒改。照片實體維持私人 R2，Supabase 保存索引，保留舊 Storage 混讀。班表省去空 workspace 載入、DOM 索引加速；freeze 偏好凍結首列／前三欄，無第二個垂直捲軸；頁內禁止原生右鍵，原快捷／剪貼功能保留。後台品牌改部門／職稱，最高管理員無員工編制顯示系統管理。

82張原表欄位／802筆Storage metadata在副本演練與正式交易前後雜湊保持一致；備份包含 metadata，非二進位照片備份。Edge／WebKit手機完整6照片送出、轉圈、捲動及工單分離，班表右鍵／剪貼／偏好／凍結測試通過。正式本人通知／部門職稱、RPC ACL及7個資產雜湊核對通過；臨時session已清除，未送出正式業務表單。前端資產20261125-5；Worker `9cc9a401-9b78-4fa4-8af1-ac40409851cb`。詳見 docs/2026-11-25-maintenance-and-roster-repairs.md。


檢查日期：2026-11-25（Asia/Taipei）。供另一個 ChatGPT Business 帳號的 Codex 在既有系統上接續開發；本文件不包含密碼、登入代碼、Token、服務金鑰、Session 或實際人員／車輛資料。

## 2026-11-25 重新整理保留功能頁（最新）

修正登入恢復把已記憶後台頁面覆寫成 home 的問題；明確桌面啟動優先、一般 F5 回原功能。每分頁 sessionStorage 優先，舊 localStorage 相容，角色／帳號隔離，登出清除；新登入首頁及權限規則不變。Edge／WebKit 跨角色／跨分頁測試通過，純前端 app v20261125-4，無 DB／API 更新。見 docs/2026-11-25-refresh-location.md。

## 2026-11-25 訂餐、保養判讀、班表與選單（最新）

已發布內部全員訂購便當（店家、凍結菜單／價格的單次團、截止鎖單、每人備註及費用統計、CSV）；八方台中參考菜單可編輯，非指定門市最新核價。保養明示衝突日期／數值、需安排與資料待核對分流；前次待工單不遮後續到期。班表合併RPC、20秒小快取與完整 stamp 失效條件，自動換車備註只顯數字。最高管理員新增全公司導航排序／分組／改名，不改有效權限。三個增量 migration 20261125010000／020000／030000，原76表與802筆 Storage metadata 通過保護校驗；app／表格樣式 v20261125-3，班表 v20261125-2。完整表格狀態依後續要求只留小型驚嘆號／正常勾號，點擊展開原因；卡片仍保留詳細原因。見 docs/2026-11-25-office-orders-and-roster.md。

## 2026-11-24 報班清單與換車安排（最新）

已發布日期生效換車：車輛管理／司機班表的「換車安排」，預覽、接替／共用、取消，driver_history 為日期權威，jobs 保存 audit／CAS／防重複。班表自動備註獨立於人工內容，司機只取當日有效車輛；無當日歷史不可 fallback 到過期 raw 駕駛。後台依使用者確認僅亞菲得待上線／跑趟中，前台車商開關不變。報班清單分五欄與手機卡片；含預配車牌。新 migration 20261124020000，原75表與802筆 Storage metadata 通過副本及正式交易雜湊保護。資產 20261124-7，詳見 docs/2026-11-24-vehicle-assignment-timeline.md；不另行同步車輛租借或倒改歷史。17位啟用員工 personal 且完整功能目錄無缺權限已唯讀核對。

## 2026-11-24 班表右鍵選單與原生剪貼（最新操作）

一般每日格子左鍵仍編輯備註／顏色；右鍵僅出車／休假，休假再次選取取消該日。姓名左鍵恢復報班日曆，右鍵改位置，姓名黑色置中。左鍵拖曳矩形後真實 Ctrl+C、點目的格、Ctrl+V 可直接貼上，保留選取／焦點供再次複製；工具列貼上保留預覽。原交易、CAS、200格與休假審核規則不變。Edge／WebKit 真實鍵盤及四尺寸測試通過，純前端、無資料庫／API變更；詳見 docs/2026-11-24-roster-context-menu.md。下方姓名雙擊／左鍵快捷為歷史操作，已被本段取代。

## 2026-11-24 即時通訊與班表快速編輯（最新）

群組聊天修正固定版面／延後載入輸入區／錯誤時保留訊息／成員 metadata 防呆及切換競態。班表改單擊格子開備註／顏色與出車、休假快捷；保養標籤仍開排程。姓名下為駕駛區域＋班表位置，雙擊姓名改位置；車牌下讀車款 model。範圍選取＋Shift／方向鍵、Ctrl+C／Ctrl+V／工具鈕提供最多200格原子貼上與預覽；底部按篩選統計休假／待審。維持單一頁面垂直捲動與原排序偏好。

已增量套用 20261124010000_roster_quick_edit，位置使用獨立 profiles／audit，出車不偽造月報，既有審核狀態與其他日期保留；退回報班不可用快捷悄悄核准。正式原73張表欄位與 Storage metadata 通過交易雜湊校驗，未覆蓋駕駛、車輛、保單或保養履歷。資產 20261124-4，詳見 docs/2026-11-24-chat-and-roster-quick-edit.md；下方雙擊格子描述為舊操作。

## 2026-11-23 班表顏色、排程與廠商目錄（最新）

基準 569997d 後新增：班表雙擊可存格子色彩（預設／自訂／清除、revision CAS、audit、舊客戶端保色）；保養／調胎按鈕以 calendar 權限開完整排程編輯，取消需原因及確認，同步取消通知、保留檔案與歷史，完成案件只讀。有效班表與各角色日曆不再顯示取消排程。廠商管理改為桌面精簡列／手機等高小卡，保留全部類別及操作。

新增已套用 migration 20261123050000／20261123060000（不要修改重放），API 已部署；原 72 張表欄位與 Storage metadata 經備份、隔離演練及正式交易雜湊校驗未變。前端資產 20261123-12，發布明細與測試見 docs/2026-11-23-roster-colors-and-partner-directory.md。

外部亞菲得行控平台 v10 僅做公開頁面／前端檢視，未登入或改動來源；可分階段整合但必須先取得 .gs 原始碼、試算表結構、Google 授權與對帳樣本，詳見 docs/2026-11-23-apps-script-integration-review.md。未完成遷移，不能將前端 API 名稱推測成後端已驗證。

## 2026-11-23 雲端播報與作業更新（優先閱讀）

同日最新班表捲軸修正：移除表格固定高度及內部垂直捲軸，所有司機展開，整頁共用上下捲動；窄螢幕僅保留必要橫向滑動。觸控拖曳的邊緣捲動改為捲動網頁。以 52 位合成司機在 Edge／WebKit 驗證完整末列、表格無垂直溢出、滾輪只動網頁及原排序／篩選流程。純前端，正式  e450e345-9c53-4cd7-a29d-dca00d1b9fae、資產 20261123-10，四檔下載雜湊一致。

正式營運設定：依使用者本次「目前員工權限全開」指示，檢查 17 位啟用員工均為個人權限，再透過既有 staff_employee_save、updated_at CAS、單一交易及 audit 開啟目前 35 項可授權功能。15 位更新、2 位原本已全開；1 位停用帳號、部門／職稱、登入代碼及最高管理員專屬限制不變。交易內校驗其他員工欄位與部門資料未變，提交後唯讀核對全員權限及 15 筆 audit。這是當次正式設定，不是預設權限或 migration，不可在測試／部署／新員工建立時自動重放；不把個別人員資料、私人備份或套用 SQL 提交 Git。

同日最新介面精簡：駕駛管理區域選單下的舊值提示文字移除，五個選項及後端驗證保留；司機班表移除上下箭頭，以拖曳點排序，新增觸控／筆 Pointer Events 排序與取消清理，並保留 Alt＋方向鍵的鍵盤操作，不顯示箭頭按鈕。顯示順序的個人記憶沿用。Edge／WebKit 雙向拖曳、模擬觸控、鍵盤、無提示／無箭頭及原班表流程通過。純前端，沒有資料庫或 API 更動；正式前端 50022b0b-ffd0-427e-97e1-344d443e7f70，資產 20261123-9，四檔正式雜湊一致。下方較早版本／上下按鈕描述為歷史。

最新版本見 [司機班表排序與顯示偏好](docs/driver-roster-preferences-20261123.md)：更名司機班表、雙向拖曳／上下移動、五標準區域、整月／週次／日期區間、隱藏過去、自動擴欄及完成保養反灰。顯示設定與排序按帳號存於目前瀏覽器，不跨裝置同步。既有未知區域不批次改寫；API 驗證新區域但保留不變舊值。無 migration 或舊資料修改。正式前端 7dfc3f6b-7c90-4724-aeb6-8653536cdc5e、data-api 97；Edge／WebKit 及正式唯讀／資產雜湊檢查通過。下方版本為歷史。

最新接續更新見 [班表、司機選取與保養工單](docs/roster-selection-work-orders-20261123.md)：獨立班表頁（沿用 driverReporting 權限）、固定司機／目前車牌／每月班別欄、緊湊全月格；未報班也可後台安排休假；報班清單／意見反饋／交付搜尋更新。所有新司機選取排除離職，九種業務表後端擋新指派但保留既有歷史關聯。保養完成可勾選尚未有工單，仍要里程及四輪照片；後台標示待補登。兩份 20261123030000／040000 migration 已正式部署，不能修改；70 張原表及 Storage metadata 保留校驗通過。正式前端 01e539d4-37af-4d93-925b-85ec441cdee5、data-api 96。本節下方舊版本僅作歷史。

車輛司機頭像修正：先前按需載入的精簡 drivers 投影漏了 photo_url，導致車輛圖像卡片及租借卡片失去頭像。僅 vehicles／vehicleLoans view 補回 photo_url，其他功能維持原精簡資料；partial_tables 及編輯前取得完整紀錄的保護保留。正式 data-api **94**，自訂 Session 驗證不變，沒有 migration／資料寫入。實際 loadAdminData 投影測試、320／390／768／1440px 車輛圖像照片解碼及既有工作區回歸通過；正式唯讀確認兩個 view 含既有頭像且不回傳身分證／駕照欄位，臨時驗證 Session 已移除。

同日後續修正：電視新聞固定靜音、移除新聞聲音開關；廣播不呼叫 pauseVideo，結束後檢查既有播放器並恢復播放，包含延遲暫停事件、可見頁每五秒本機狀態檢查與回頁恢復；不重新下載／重載直播。音訊播放期間不搶回媒體焦點，避免中斷廣播。Edge／WebKit 模擬音訊焦點暫停與延遲暫停、原看板流程皆通過，實體 LG 仍需現場確認。正式三個資產雜湊一致；前端新版 `6b0db875-fa24-4a85-b9ba-ec98b18a8fbe`、看板 JS `20261123-3`，無資料庫或後端變更。本節下列較早前端版本由此取代。

見 [電視語音、交付檢查、班表與通訊](docs/operations-board-inspections-roster-20261123.md)。依使用者選擇，以原生 Worker 相容 gTTS RPC 產生台灣中文 MP3，私人 R2 共用快取，無需 Azure／信用卡／Google API key；正式雲端合成與瀏覽器解碼已驗證，實體 LG 尚待現場點一次啟用播報。後台新增電子廣播及公告圖片；**公告電視前台原本顯示方式不變**。新增交付／返還檢查、無上限損傷照片分頁、單案 ZIP、月班表與每日備註、聊天已讀／群組 @ 及派趟明細樣式。兩個 20261123 migration 已正式套用並驗證原有 68 表欄位及 Storage metadata 不變，不得修改已部署 migration。data-api 93；前端 4c719dd0-ec8e-4f79-b59f-d9abaaf21563，R2 f5494b91-ffbb-475e-9a19-2d71768419a9。下列較早版本僅作歷史。gTTS 不是有 SLA 的官方付費 API，可能限流；保留上傳 MP3 路徑。詳見發布文件的測試／設定及待辦。

## 2026-11-21 員工、部門與統一卡片（優先閱讀）

見 [員工部門管理](docs/staff-departments-20261121.md)。權限管理更名員工管理，保留 adminUsers 鍵；新增部門／職稱 CRUD 與部門權限，既有人員預設 personal 不改原權限。部門繼承是獨立模式，後端 effectiveStaffPermissions 執行，個人設定保留。已有員工使用的部門／職稱禁止刪除；其餘 soft delete、revision、員工 expected_updated_at 與 audit。migration 20261121030000 已部署，不能再修改此檔假裝正式同步；發布交易確認原 65 表既有欄位內容不變。前端 32f7684d-6acc-4820-8b89-031fae1e1695，data-api version 91。部門 UI 按需載入；廠商卡片統一高度及資訊位置。Google Drive／Gmail OAuth 尚未接通；可整合的評估見文件，不可宣稱已授權讀取。

## 2026-11-21 廠商管理排版修正（優先閱讀）

廠商卡片聯絡資訊及操作按鈕在窄螢幕會超出卡片可見區，長電話／備註未斷行。新增 partner-directory 範圍樣式：自適應網格、固定 Logo 欄、可換行完整名稱、狀態固定、資訊與按鈕不溢出；Logo 失敗以安全的文字節點回退。Edge／WebKit 的 320／390／768／1024／1440px、分類切換與編輯入口測試通過。只修改前端，沒有資料庫／API 變更。

## 2026-11-21 首頁待辦縮小

依使用者指定，「待我處理」改成首頁天氣左邊的同尺寸小框，只顯示名稱與待辦總數，不展開明細。點擊小框僅刷新數字，不開對話框／不改案件。手機仍為左右並排，兩框同寬同高；天氣長文字換行避免溢出。沿用原本權限與一分鐘快取，本次只部署前端，沒有後端／資料庫變更。

## 2026-11-21 按需載入與待辦

接續 05fc339，見 [按需載入、後端分頁與待辦](docs/workspace-on-demand-20261121.md)。使用者只要求建議第 1、3、4 項，薪資後端二次驗證仍未實作。新 migration 20261121010000／20261121020000 只增加唯讀函式及台北日期顯示修正，已有完整正式快照備份、隔離演練及正式交易雜湊保護。後台使用 view 白名單查詢；費用為真正伺服器 50 筆分頁與全篩選統計；新增費用／待辦前端模組，原報班／車檢／點數／看板模組改按需下載。首頁待辦按權限顯示保養、保險、罰單，並非自動變更流程。精簡司機清單標記 partial_tables，編輯 driver／vehicle／vehicleFolder 會另讀完整紀錄；不可取消這個保護。正式查核車輛回應 3.56 MB → 418 KB 是特定 JSON 回應改善，不可宣稱整體月流量降 88%。

## 2026-11-21 操作優化與全系統建議

接續 e9c134e，完整建議與驗證界線見 [系統操作與效能檢視](docs/system-usability-review-20261121.md)。本次僅前端：天氣六地同段跑馬燈；點數改搜尋／二十位分頁／固定選取摘要／確認期防連點；費用加篩選／五十筆顯示分頁／統計與逾期提示。既有正式資料、點數交易與收款狀態含義不變，登入頁不變。薪資卡片尚未解鎖時摘要不顯示金額，但後端二次授權尚未新增；工作區大範圍載入、模組拆分與薪資保護列為下一階段優先。不可將前端分頁誤稱已減少 Supabase 傳輸。

## 2026-11-21 航班手機篩選修正

接續本節的取消／航廈播報與八小時追蹤調整見 [看板取消通知](docs/flight-terminal-announcement-20261121.md)。登入頁維持原樣；追蹤確認取消改為紅框與獨立播報、播畢三分鐘逆時針消退，未來超過八小時暫不顯示但保留追蹤。沒有資料庫 migration 或原始資料回灌；來源仍五分鐘，三分鐘來源更新／天氣合併尚未納入。

接續 `8f828bc`，見 [航班手機篩選](docs/flight-filter-mobile-20261121.md)。航班篩選改為正常文流的緊湊收合面板，機場分段選項與小型日期欄位取代舊浮動面板；移除靜態提示及初始空框。只修改前端，不變更資料庫或後端服務。Edge 與 WebKit 引擎的五種寬度、裁切命中與查詢／快取測試通過；未聲稱實體 iPhone 已測試。

正式前端版本 `3d093d80-81a5-40f8-9b0d-1adfac8a5ff3`，資產 `20261121-1`；正式下載的 HTML／JS／CSS 雜湊與測試檔一致。此次沒有建立正式 Session 或提交業務表單。

## 2026-11-20 司機工具列與派趟第四次更新

接續 `5805c62`，見 [司機工具列與派趟更新](docs/driver-toolbar-dispatch-20261120.md)。只變更前端與 R2 天氣文字，沒有業務資料庫 migration 或資料回灌。

- 新增 `assets/driver-ui.css`；所有司機頁面使用同尺寸方形返回與圖示重新整理，頁面分類／月份／分頁集中單一頂列，過長分類在頂列橫向滑動。
- HEY POINT 移除重複標題；航班篩選收進單列彈出區，仍只依班號查詢且保留十分鐘快取。報班與車檢模組保留原流程，只替換工具列。
- 司機重新進入派趟自動今天，頁內換日仍保留；前後台共用簡潔 `dispatch-trip-card` 排版。看板天氣文字省略來源／時間，但 metadata、快取與延遲判斷保留。
- 正式版本：前端 `d2ddfa89-2f44-43ec-ac53-f3dad5a17f20`、R2 `bb4510aa-2318-4724-9069-69fc69fb376a`。十五個司機頁面四種寬度與原流程回歸通過，正式唯讀確認六個主要功能及天氣文字；臨時驗證 Session／電視連結均已清理，沒有業務表單提交或資料回灌。

## 2026-11-20 看板排版、連結與輪播第三次更新

接續 `934ce02`，見 [本次功能與驗證](docs/board-links-weather-ui-20261120.md)。本次只有前端／R2 Worker，沒有業務資料庫 migration 或舊資料回灌。

- 保養表格操作改為文字按鈕；看板管理獨立響應式 CSS，跑馬燈與公告分區更新，未發布草稿保留。
- 電視只顯示公告標題／內文，航空公司與航班編號同列、同字級。跑馬燈交錯顯示公告、六地溫度／今日降雨與 TWSE 加權指數，天氣三十分鐘／台股五分鐘共用 R2 快取，不用 Supabase。
- 永久連結以既有 MEDIA_SIGNING_SECRET 推導的 AES-GCM 加密保存，授權管理員可再次取回。舊雜湊無法逆推，在原電視重新連線時安全補存；未重新連線者需原電視重新整理或產生新連結。清單不回傳 Token，連結仍可撤銷。
- 正式版本：前端 `e9f26981-43f0-4425-ae74-52ca336835e1`、R2 `5cee013d-8eaf-430a-bf5e-37c4556fe9b0`。正式確認六地天氣／TWSE 可用、連結跨管理頁重開後可取回、響應式排版與電視輪播正常；既有看板設定未變，暫時驗證 Session／連結已撤銷。

## 2026-11-20 看板與作業介面第二次更新

完整內容見 [看板管理與多人航班追蹤](docs/board-management-and-operations-20261120.md)。這一節取代下方較早的「原跑馬燈／30 天連結／每分鐘名單」說明。

- 後台新增獨立「看板管理」及可授權的 `boardManagement`。電視專用跑馬燈、公司公告與永久可撤銷連結存於私人 R2 `_flight-board/`，不混用系統跑馬燈。
- 追蹤名單每 5 秒讀 R2；同瀏覽器另以 BroadcastChannel 通知。來源每 5 分鐘共用快取並顯示秒數倒數；慢來源查詢不阻塞名單。
- 同日期同航班合併司機，每頁最多 4 班、每班 4 個姓名，每 8 秒輪播。廣播完成後各筆追蹤 3 分鐘自動隱藏，司機無需取消。取消航班及超過 48 小時的追蹤不顯示，底層檔案保留供稽核。
- 安椅新增／編輯／停用／移除，移除只隱藏庫存，不刪借還／照片。借用中禁止移除與重複借用；顯示目前借用人與時間，歸還後進歷史。
- 點數發放改分頁工作區；補新功能權限。修復車商權限 hidden false 蓋過勾選 true，保留未知舊鍵，後端執行車商功能開關。
- 保養完整表格改成 17 欄，保養／調胎分色、日期數字不亂換行，保留核對里程與待補工單。頁面只有一個垂直捲軸，寬表可橫向閱讀。
- 增量 migration `20261120040000_equipment_inventory_visibility.sql`：備份當下 65 張表後完整隔離演練；只增加隱藏標記與替換用品查詢 RPC，不更新既有業務欄位。
- 已正式發布：前端 `8a21cda8-aee1-4755-985e-3c4be7f16e74`、R2 `70d55e47-d2ce-4d86-ba55-1485c1007b1c`，data-api／flights 亦更新。發布後 65 張表原始欄位／資料列無變更或遺失，791 筆 Storage metadata 保留；驗證用暫時 Session／電視連結已清理。

## 2026-11-20 較早功能發布增補

以下發布晚於本文件最初的 `08d9932` 文件提交；後面各節中的舊版本數字保留作歷史查核，不代表目前正式版本。完整變更與驗證見 [本次發布文件](docs/driver-operations-flight-board-20261120.md)。

- 已發布檢查批次編輯／指定角度抽檢／ZIP 與確認後清理、保養五張照片、HEY POINT 與用品借還、系統頭像、聊天增量／瀏覽器通知與多項手機介面修正。連結管理已停用，歷史資料保留。
- 電視入口 `/flight-board`：私人可撤銷配對、本人追蹤桃園抵達航班、中文廣播及原跑馬燈。台視實測限制外站播放，使用者已同意替換；目前為可嵌入且實測播放的華視新聞 CH52 官方直播。新聞直接連 YouTube，廣播時靜音並恢復。
- 新照片直傳私人 R2，Supabase 保存許可／簽收與 metadata；舊 Supabase 照片混合讀取、原路徑保留。照片／點數／用品新 handler 與前端檔案清單見發布文件。
- 新增三個 migration：`20261120010000`、`20261120020000`、`20261120030000`，不得在正式庫重跑。已以完整正式資料隔離演練及發布後查核，原有 56 張表的既有欄位／資料列無變更或遺失；原有 32 筆檢查任務、280 筆照片紀錄、791 筆 Storage object metadata 保留。
- 派趟改按日期查詢；聊天訊息增量、目錄五分鐘更新；首頁不自動預抓全工作區。電視來源五分鐘共用快取，直連 522 時用壓縮航班備援，必要時標示 TDX 桃園來源；不查其他機場，也不把各台電視轉成全量 Supabase 查詢。
- 新設定名稱：`DIRECT_MEDIA_UPLOAD`（前端）、`MEDIA_SIGNING_SECRET`（兩服務）、`MEDIA_API_URL`／`MEDIA_PUBLIC_ORIGIN`（data-api）、`CTS_LIVE_VIDEO_ID`（R2 Worker，選填非機密）。機密已在原公司服務設定，不在 Git；新帳號須用自己的公司授權。
- 正式前端版本 `3b0a4aac-24f5-4558-b735-7819229b2c64`；R2 Worker `c14f08cd-5eed-4809-8955-dec6eba1328c`。API 與 flights 亦已更新；後續以實際平台與 Git 查核為準。
- 仍需現場確認：電視喇叭、瀏覽器中文語音、首次按「啟用降落廣播」與全螢幕。瀏覽器通知需要網站開啟及允許通知，未實作關閉網站後的 Web Push。

## 1. 接手摘要與證據範圍

本次實際讀取 Git、前後端原始碼、設定檔、migration、測試及既有發布文件；執行 `git fetch origin`、語法與管理操作測試，並唯讀查核正式資料庫版本及 Cloudflare 發布記錄。沒有重建系統、修改正式業務資料或重部署應用程式。

| 項目 | 查核結果 |
| --- | --- |
| Repository | https://github.com/feastogether/heycar |
| 可見性 | 2026-11-20 GitHub 公開 API 回傳 `private: false`，目前為公開 Repository |
| GitHub 預設／正式原始碼分支 | `main` |
| 本次文件建立前的應用程式 Commit | `415ba93e6f9f19a7ef26ce3dbee0211211ae5214` |
| Commit 說明 | Add audited admin leave calendar edits and reversible dated inspection batches |
| 實際開發分支 | `review/fleet-integration` |
| 正式網站 | https://heycar.airvan.workers.dev |
| 招募入口 | 正式網站的 `/hiring` |
| Supabase 專案 | `chnvwziuqcqnllcjqobj`；https://chnvwziuqcqnllcjqobj.supabase.co |
| 正式資料庫 | 唯讀確認 public 基礎資料表 56 張；最新 migration `20261118020000` |
| 正式前端版本 | Cloudflare `7ec4efb1-dae1-464c-88d4-4f1f914ecbf7`，2026-11-18 發布 |
| 最新報班／檢查資產版本 | `20261118-2`，見 `index.html` |

上述 Commit 是文件建立前的應用程式基準，不是要求將新分支 reset 到此版本。交接文件提交後的最新 SHA 請以 `git log -1`／`git rev-parse HEAD` 為準。

### 本機目錄與 worktree

- 原專案／`main`：`C:/Users/nioon/Documents/Codex/2026-05-24/supabase-githubpage-logo-https-www-heycar`
- 實際開發 worktree／`review/fleet-integration`：`C:/Users/nioon/Documents/Codex/2026-05-24/supabase-githubpage-logo-https-www-heycar-fleet-review`
- 對話顯示的 `C:/Users/nioon/Documents/Codex/2026-09-12/context-window-worktree-git-github-github-2` 不是上述 Git 專案；不要在那裡另建一套系統。
- 開始本次工作時兩個 worktree 都在 `415ba93`，開發 worktree 乾淨；fetch 後與 `origin/main` 的 ahead／behind 為 `0 / 0`。
- 原 `main` worktree 有未追蹤的 `desktop/dist/`、`desktop/package-lock.json`、`tmp/`。本次保留，未讀取或提交其可能包含的私人內容。不可 `git clean` 清掉它們，也不可直接整包上傳。

## 2. 系統主要目的與完整功能架構

這是亞菲得 HEYCAR 的車隊營運、員工辦公與合作車商入口。共用一套既有資料庫與登入／權限系統；瀏覽器依角色提供後台、司機、車商、保經等畫面。不是 PHP、WordPress、React 或 Next.js 專案。

| 功能域 | 已有功能與入口 |
| --- | --- |
| 登入與權限 | 員工／司機／合作廠商登入代碼、最高管理員、功能權限、登入紀錄、LINE／LIFF 綁定、個人頭像；共用舊代碼登入已停用 |
| 員工辦公室 | 首頁、內部公告與內容彈窗、員工行事曆、夥伴頭像／姓名／登入代碼分機、個人短訊跑馬燈、今日與明日辦公室天氣 |
| 即時通訊 | 同事聯絡人、頭像、個人對話、群組建立與群組對話、未讀與最近訊息排序、手機版對話介面 |
| 駕駛與上線 | 駕駛基本資料／所屬車商／狀態、文件及 OCR、上線檢核、結案時選擇司機狀態、司機幫手、意見反饋 |
| 派趟 | 訂單匯入、日期左右切換、車商／司機對應、手機卡片、司機執行與完成、車商對未指派訂單指派自家司機 |
| 航班 | 指定航班號碼查詢、桃園／高雄／TDX 資料整合、狀態中文化、共掛班號、十分鐘快取；進入查詢頁不自動載入全部航班 |
| 司機報班 | 車商權限開關、月份開放期間、禁休日、多組條件限休、司機一次送出、超額審核、後台清單／日曆／匯出／審核／不受限的個別日曆修改 |
| 車輛管理 | 車牌／車型／車商／狀態、目前駕駛與駕駛歷程、報廢／出售、保險公司與到期日、保單與罰單檢視、分類文件上傳；列表不直接提供刪除 |
| 廠商與車種 | 車商、保經、保修廠、保險公司等集中目錄、廠商前台權限、車種及 BOM 零件／套餐 |
| 保養管理 | 加油報表匯入、可信里程與日均里程、保養／調胎預測、卡片及表格、排程／日曆、通知目前駕駛或指定司機、司機完成確認、待補工單提醒、群發通知 |
| 車輛履歷 | 人工工單、多類型、每個零件類型、送修原因／實際維修、金額及含稅／未稅拆分、同車同日重複檢查、儲存鎖定與版本保護 |
| 怠速管理 | 多份每日 Excel 匯入、日／週檢視、全車清單、駕駛顯示、時分編輯、截圖／高清圖片／Excel 匯出、車輛可見設定 |
| 罰單管理 | 新增／匯入、100 筆分頁、處理回報與歷程、附件、期限排序與急件、資料待清理、車商權限隔離及手機精簡卡；歷史資料曾依要求清空，功能保留 |
| 保險中心 | 報價、補件重送、車商確認與更改原因、保費、保單／收據、保險期間、批改／新增、狀態稽核、完成回寫車輛保險、續保提示 |
| 車輛檢查 | 後台發起、日期批號、十個拍攝位置、壓縮上傳、草稿、指定角度補拍、審核、照片版本、共用車任務、整批取消／可復原刪除 |
| 內部租借 | 目前借用人／時間、預借、核准／還車／結案、版本及重複操作防護；與正式駕駛指派分開 |
| 其他營運 | 對司機公告、個人訊息、費用、緊急事件、跑馬燈號、標語、連結、寄信管理與標籤列印、儲存空間、流量及衛星犬監測 |
| 招募 | `/hiring` 宣傳頁、機場視覺、可編輯價格及方案／介紹、應徵資料及後台管理 |
| Windows 列印站 | `desktop/` Electron 全螢幕入口，車輛租借／寄信管理兩選項，載入正式網站並使用有效帳號登入 |

選單以 `app.js` 的 `adminNavLabels`、`adminNavDepartments`、`adminPermissionCatalog()` 及各角色 render／load 為準。舊權限鍵 `fleetOperations`、`calendar`、`maintenanceNotifications` 仍支援整合後功能，不可因主選單沒顯示就直接刪除。

## 3. 已完成、開發中、未開發與歷史狀態

### 已完成並有發布依據

- 11/17：車務整合、獨立舊保養基準、保養到工單流程、租借還車修正、車輛檢查、當時最新舊站資料接入。
- 11/18：手機頭像／報班版面與返回、條件限休、雙司機共用檢查、直接點位置格拍照。
- 11/18 最新：後台不受限日曆編輯、保留審核／修改紀錄、位置示意拍照格、日期批號及整批取消／可復原刪除。
- 正式 migration 及 Cloudflare 最新版本在本次重新查核一致。不能把 11/13 的「僅本機／尚未發布」歷史文件當作現況。

### 現在開發中

文件建立前沒有追蹤中的未提交功能修改，也沒有找到已實作但等待推送的功能分支差異。本次交付是交接文件與開發規範；不把下列提案稱為已開發功能。

### 尚未完成／不能宣稱具備

- 將正式系統完整切換到 Windows 11 Surface Go 2：曾部署自架 Supabase／Docker，但有 Edge Runtime CPU／服務連線等問題；本機 repo 沒有完整可重現的 Go 2 安裝套件。本次未連線該電腦，無法宣稱修好或已切換。
- Google Drive 保單的全自動持續同步／抓取：沒有看到可部署的排程同步服務；目前檔案或來源連結必須按實際匯入／上傳流程處理。
- 舊站 `https://heycars.vercel.app/` 與新版雙向自動同步：未建置。11/17 接入僅為當次遷移，不能視作舊站後續變更會自動進來。
- 新機單一步驟重現開發環境／完整 CI：根目錄沒有 package.json、依賴 lockfile 或統一測試 runner，部分預覽依賴私人資料夾。下節給出明確重建依賴方式。
- 同車多人已有不同照片進度的自動合併、拍到一半直接換另一司機續拍：不支援；保留原紀錄並由管理員決定取消重發，不能自動混合照片。

## 4. 技術與 API 架構

```text
瀏覽器（index.html + 原生 JS/CSS）
 ├─ config.js → Supabase functions/v1/data-api（POST action + x-afide-session）
 │   ├─ app_sessions 驗證／角色與功能授權
 │   ├─ Supabase JS server client → PostgreSQL／PostgREST
 │   └─ 工作流模組 → 具權限限制的 PostgreSQL RPC／交易與稽核
 ├─ functions/v1/flights → 機場公開資料／TDX
 └─ Cloudflare heycar（frontend-worker.js）
     ├─ ASSETS → cloudflare-public
     ├─ /api/office-weather → Open-Meteo
     └─ /api/storage、/files/* → STORAGE Service Binding
         → heycar-r2-storage → 私有 R2 heycar-attachments

車輛檢查照片另存 Supabase 私有 vehicle-inspections bucket；
一般舊附件保留 Supabase attachments／歷史網址，不能假設全部都在 R2。
```

### 前端

- 無框架、無根目錄打包依賴。`app.js` 管理狀態、畫面、表單、API、匯入與輪詢；`index.html` 控制 JS／CSS 載入順序。
- `window.AFIDE_CONFIG` 提供公開端點，並非放服務端密鑰的位置。
- 專用功能分出 `HeycarFleetReports`、`HeycarDriverReporting`、`HeycarVehicleInspections` 等全域模組；不要破壞 mount 參數、API 回傳包裝及路由。
- Excel、OCR、截圖、LINE、地圖有按需載入的 CDN 依賴；離線環境不能假設全部可用。
- 天氣、聊天、派趟等各自快取／更新；不要為修一頁而全站提高輪詢頻率。

### 後端與身分

- Supabase Edge Functions 使用 TypeScript／Deno；data-api 是 `action` 分派 API，不是每張表直接開放給瀏覽器 CRUD。
- 登入回傳應用工作階段，後續以 `x-afide-session` 傳入；`app_sessions` 記錄角色、有效期限及對應人員。這不等同純 Supabase Auth 瀏覽器登入流程。
- 通用 load／save／delete 以角色、功能鍵、欄位白名單及關聯限制控管；報班、保險、保養、檢查、租借等使用專用動作與 RPC。不要繞過它們直接 upsert 整張車輛。
- 例：`load_driver_reporting`、`submit_driver_reporting`、`review_driver_reporting`、`admin_edit_driver_reporting`；`inspection_load`、`inspection_create`、`inspection_photo`、`inspection_submit`、`inspection_batches`、`inspection_batch_action`。完整 action 清單以 handler 與 `index.ts` 分派為準。
- 伺服器使用 `SUPABASE_SERVICE_ROLE_KEY`，因此 API 的授權檢查不可省略；SQL SECURITY DEFINER 函式的 EXECUTE 權限也必須維持限制。
- CORS 已限定正式站並處理允許來源；遷網域須同步查前後端與第三方設定，不能只改 DNS。

### 資料庫與附件

正式 PostgreSQL 為資料權威；本機 PGlite／JSON 都只是測試或預覽。重要資料群如下（不是全部 56 表的替代 schema）：

| 資料群 | 重要資料表 |
| --- | --- |
| 人員／授權 | `drivers`、`admin_users`、`insurance_partners`、`app_sessions`、`login_audit_logs`、`key_access_codes`、`avatar_profiles` |
| 車輛／履歷 | `vehicles`、`vehicle_types`、`vehicle_service_records`、`bom_parts`、`bom_packages`；`driver_history`／`vehicle_files` 等保存在車輛欄位 |
| 派趟／上線 | `dispatch_orders`；上線欄位與檔案透過駕駛資料及專用工作流保存 |
| 車務／保單／罰單 | `fleet_idle_daily`、`fleet_fuel_stats`、`fleet_service_baselines`、`fleet_policy_documents`、`fleet_fines`、`fleet_fine_updates`、`fleet_fine_files`、`fleet_migration_reviews` |
| 排程／通知 | `calendar_events`、`maintenance_notifications`、`maintenance_notification_batches`；`maintenance_records` 為既有資料模型，不可與新工單混淆 |
| 保險 | `insurance_requests` 與其資料欄位／歷程、廠商與車輛保險欄位 |
| 報班 | `driver_reporting_months`、`driver_reporting_submissions`、`driver_reporting_audit` |
| 檢查 | `vehicle_inspection_batches`、`vehicle_inspection_tasks`、`vehicle_inspection_photos`、`vehicle_inspection_audit` |
| 租借 | `vehicle_loans`、`vehicle_loan_actions` |
| 員工／通訊 | `staff_announcements`、`staff_calendar_events`、`staff_notes`、`admin_chat_messages`、`admin_chat_groups`、`admin_chat_group_members`、`admin_chat_group_messages` |
| 營運／招募 | `announcements`、`announcement_reads`、`personal_messages`、`payment_notices`、`marquee_messages`、`emergency_events`、`feedbacks`、`driver_links`、`driver_helper_articles`、`login_slogans`、`mail_recipients`、`mail_shipments`、`hiring_pages`、`hiring_applications` |

`supabase-schema.sql` 是早期基礎結構，不是最新正式資料庫完整 dump；必須搭配 migration 和當下正式 schema。新庫重建不能直接以此檔案推定成功。資料表列數會隨營運增加，11/17、11/18 發布文件的數字是當日查核值，不是本日全量筆數。

附件還原需同時處理表格／metadata 與實體物件：Supabase `attachments`、`vehicle-inspections`、Cloudflare R2，以及外部 Google Drive 來源可能並存。只還原 SQL 不會還原全部檔案。

## 5. 重要檔案與資料夾

| 路徑 | 用途／注意事項 |
| --- | --- |
| `AGENTS.md` | 後續 Codex 操作規範；新帳號先讀 |
| `PROJECT_HANDOVER.md` | 本文件，當前交接入口 |
| `app.js` | 主應用；角色畫面、狀態、表單、車務、匯入、聊天、登入等核心 |
| `index.html` | 主頁入口、資產載入順序與快取版號 |
| `config.js`／`config.example.js` | 公開 API／LINE 設定及範本，嚴禁服務端密鑰 |
| `styles.css`／`heycar-ui-enhance.css` | 全站基礎樣式與增強；全域 input 規則曾造成 checkbox 跑版 |
| `login.css`／`hiring.css`／`staff-home.css` | 登入、招募及員工首頁 |
| `assets/fleet-reports.js` | 車牌正規化、怠速／加油／罰單解析、可信里程與預測純計算 |
| `assets/driver-reporting.js`／`.css` | 報班前後台、規則、日曆、審核與管理員編輯 |
| `assets/vehicle-inspections.js`／`.css` | 檢查拍攝／壓縮／草稿／補拍／審核／批次管理 |
| `assets/workspace-refinements.css` | 車務及手機版細節覆寫；注意 CSS 載入順序 |
| `assets/` 圖片 | 現行 Logo、favicon、招募主視覺、壓縮飛機輪播等；不能未檢查引用就刪除舊素材 |
| `supabase/functions/data-api/index.ts` | API 入口、session／權限、欄位與資料保護、通用／專用 action 分派 |
| `…/insurance-workflow.mjs` | 保險狀態、角色操作、文件／金額／車輛同步 |
| `…/employee-workflow.mjs` | 個人頭像、保養排程／完成等工作流 |
| `…/onboarding-workflow.mjs` | 上線結案及駕駛狀態 |
| `…/driver-reporting.mjs` | 報班 API 驗證及 RPC 呼叫 |
| `…/vehicle-inspections.mjs` | 檢查權限、照片與簽名網址、批次／任務 API |
| `…/vehicle-loans.mjs` | 核准／還車／結案的專用 RPC adapter |
| `supabase/functions/flights/index.ts` | 航班來源、快取、狀態與班號整合 |
| `supabase/functions/storage-api/index.ts` | 既有 Supabase 附件 API，不能當作 R2 Worker |
| `supabase/migrations/` | 增量結構、資料保護、工作流 RPC 與權限；檔名有順序 |
| `supabase-schema.sql`／`supabase-update-20260530.sql` | 歷史建庫／更新檔，非最新一鍵安裝腳本 |
| `cloudflare/frontend-worker.js` | 靜態資產、同源 storage proxy、快取策略 |
| `cloudflare/office-weather.js` | 辦公室天氣代理／快取 |
| `cloudflare/r2-storage-worker.js` | Session 驗證、私有 R2、下載簽章、容量及附件操作 |
| `wrangler.toml` | 只部署 `heycar` 前端 Worker；binding ASSETS／STORAGE |
| `wrangler.storage.toml` | 只部署 `heycar-r2-storage`；R2 ATTACHMENTS binding |
| `scripts/build-cloudflare-frontend.ps1` | 複製前端至 `cloudflare-public/`，會遞迴清除該輸出目錄 |
| `scripts/preview-*.cjs` | 本機整合預覽、記憶體／磁碟 PGlite adapters；不是正式後端 |
| `scripts/test-*.cjs`／`test-*.sql` | 單元、資料庫、權限與瀏覽器流程測試；SQL 測試只供隔離測試庫 |
| `desktop/` | Electron 列印站；獨立 package.json、啟動器與 preload |
| `docs/` | 功能及發布驗證紀錄，按日期判讀；較舊文件可能已被後續發布取代 |
| `DEVELOPMENT-HANDOFF.md` | 原有長期歷史交接；先讀最上方最新註記 |
| `AUTH-AUDIT-FIX.md`、`CHAT-GROUPS.md` 等 | 個別功能歷史設計，不取代現行程式 |
| `.fleet-preview/`（Git 忽略） | 預覽 DB、fixture、私人正式備份／驗證；可能含個資，不能整包推 GitHub |
| `cloudflare-public/`、`.wrangler/`（忽略） | 產物、CLI 本機狀態；不是原始碼或交接憑證 |
| `tmp/`／`desktop/dist/`（原 main 未追蹤） | 未納管暫存／桌面產物，先分類查明，不當成可公開檔案 |

## 6. 安裝與本機啟動

### 全新電腦／新帳號

安裝 Git、Node.js 24 系列（本次執行為 24.12.0），需要瀏覽器流程時安裝 Microsoft Edge。正式發布另需要 Supabase／Cloudflare CLI 與各自被授權的帳號。

只複製以下程式碼區塊，不要連 PowerShell 的 `PS C:\…>` 提示字一起貼上：

```powershell
git clone https://github.com/feastogether/heycar.git heycar
cd heycar
git status --short --branch
git log -1 --oneline
# 可用自己的功能分支，不必建立新的網站／資料庫。
git switch -c work/next-change

# 現有測試硬編碼從 .fleet-preview/node_modules 載入 PGlite。
npm install --prefix .fleet-preview --no-save @electric-sql/pglite@0.5.15 playwright@1.65.0
$env:NODE_PATH = Join-Path (Get-Location) '.fleet-preview/node_modules'
```

這只安裝本機測試依賴，不代表前端需要 npm build。版本是本次已安裝查驗值；未來升級需回歸，不要直接認為最新版等價。現有測試多使用 `channel:'msedge'`；沒有 Edge 的平台需安裝對應瀏覽器並調整測試設定，不能只執行預設 Chromium 安裝就假設可跑。

### 安全的合成資料預覽

新 clone 不包含 `.fleet-preview/data.json`。可由已追蹤的測試 fixture 建立，不要向正式環境下載個資來取代它：

```powershell
node -e "const fs=require('fs');fs.mkdirSync('.fleet-preview',{recursive:true});fs.writeFileSync('.fleet-preview/data.json',JSON.stringify(require('./scripts/test-local-fixture.cjs').fixture));"
$env:REPORTING_PREVIEW_DB = 'memory'
$env:INSPECTION_PREVIEW_DB = 'memory'
node scripts/preview-fleet-workspace.cjs
```

在同一台電腦開啟 `http://127.0.0.1:4183/`，以頁面上預覽角色切換；僅綁 loopback，不可公開暴露預覽伺服器。停止按 Ctrl+C。記憶體 DB 重啟會清除測試報班／檢查；不要在既有工作目錄重跑 fixture 產生指令覆蓋原預覽進度。

本機 fixture 的資料操作會寫入本機 JSON／PGlite，預覽 API 替代正式端點；單純用靜態伺服器開正式 `config.js` 則可能仍連正式 API，兩者不可混淆。正式登入請勿用於測試寫入。

原開發機另有未追蹤依賴及私人預覽資料；新帳號若換機，依上面合成流程啟動，不要求搬運全部 `.fleet-preview`。

### 桌面程式

```powershell
cd desktop
npm install
npm start
# 僅要打包安裝程式時：
npm run dist
```

Electron 目前為載入正式網站的全螢幕殼，不是本機資料庫，也不是免登入後門。EXE 為未簽署發行的可能情況，Windows 智慧型應用程式控制問題不能以要求使用者關閉系統保護作為預設解法；先確認發行簽章及可信安裝方式。

## 7. 測試方式與目前驗證

先在專案根目錄設定上述 NODE_PATH。測試使用 Node stripTypeScriptTypes／VM、PGlite 及 Playwright；不要在正式資料庫直接執行 `test-*.sql`。

```powershell
node --check app.js
node --check assets/driver-reporting.js
node --check assets/vehicle-inspections.js
node scripts/test-auth-audit.cjs
node scripts/test-dispatch.cjs
node scripts/test-service-completion.cjs
node scripts/test-driver-reporting.cjs
node scripts/test-reporting-range-rules.cjs
node scripts/test-shared-inspections.cjs
node scripts/test-admin-leave-and-batches.cjs
node scripts/test-vehicle-inspections.cjs
node scripts/test-vehicle-loans.cjs
```

| 測試組 | 主要檢查 |
| --- | --- |
| `test-login`／`test-auth-audit`／`test-storage-signing` | 登入、舊共用碼拒絕、成功失敗稽核、分頁、儲存簽章 |
| `test-dispatch` | 派趟匯入／車商隔離／航班快取及可選瀏覽器檢查 |
| `test-legacy-service-baselines`／`test-service-completion` | 獨立基準、不自動寫工單、排程通知與完成／工單連結 |
| `test-driver-reporting`／`test-reporting-range-rules` | 資格、月份／禁休、超額、條件限休、角色與資料保護 |
| `test-admin-leave-and-batches` | 不受限管理編輯、審核歷史、批號、刪除復原、取消、權限與版本衝突 |
| `test-shared-inspections`／`test-vehicle-inspections` | 同車單任務、領取互斥、十張與補拍、版本保留及照片恢復 |
| `test-driver-reporting-ui`／`test-mobile-reporting-ui` | 前後台實際入口、手機月份列／返回／日曆、頭像、限休及共用任務 |
| `test-vehicle-inspections-ui` | 十位置點拍、壓縮／草稿／補拍／審核、批次刪除復原、借還車 UI |
| `test-workspace-refinements-ui` | 車務及手機版整合介面 |
| `test-onboarding-workflow`／`test-staff-home`／`test-chat-groups` 等 | 上線結案、首頁、通訊、招募與營運回歸 |

瀏覽器測試另外逐支執行：

```powershell
node scripts/test-driver-reporting-ui.cjs
node scripts/test-mobile-reporting-ui.cjs
node scripts/test-vehicle-inspections-ui.cjs
node scripts/test-workspace-refinements-ui.cjs
```

預覽／UI 測試使用 4183、4191、4194、4195 等本機埠，逐支啟動最安全。占用時先辨識擁有程序，不要殺掉所有 Node。既有腳本可能有 timeout 或依賴網路／CDN，失敗須確認原因，不要直接略過。

本次 2026-11-20 重跑主程式與兩個功能模組語法檢查，及 `test-admin-leave-and-batches.cjs` 通過；沒有宣稱本日重跑整套測試。11/18 完整功能與手機驗證結果見當日發布文件。

## 8. 部署方式與回復原則

### 工具與服務登入

原機查驗 CLI：Supabase 3.0.0、Wrangler 4.152.0。可安裝對應版本工具或使用 npx Wrangler；Supabase CLI 用官方平台套件／正式安裝方式。**新帳號不會繼承舊帳號 CLI 授權**，先以自己的 GitHub、Cloudflare、Supabase 帳號取得公司授權並登入。各版本 flag 以該版 `--help` 為準。

### 發布前檢查

1. fetch，確認工作目錄、差異、原始資料保護修補及目前遠端 SHA；保留所有未提交檔案。
2. 先以唯讀 metadata 查正式 migration／schema，確認只需套用哪些新增檔。不得把全部歷史 migration 直接 `db push` 到正式。
3. 對正式 schema、函式、索引、觸發器、資料與附件做可復原備份；實體附件另備份，不是只有物件 metadata。
4. 在完整備份的隔離庫演練必要增量 migration，檢查原欄位、筆數與資料。正式執行採交易、合理 timeout／鎖定、提交前資料保留檢查。
5. 先相容資料庫增量，再相依 API，最後前端；同時保留舊 API／前端版本的回復方式。功能測試與角色／手機驗證通過才發布。

### 正式命令範例（會修改線上，非交接時直接執行）

```powershell
# 先唯讀確認目標，不是本機 Go 2：
supabase db query --remote=chnvwziuqcqnllcjqobj --read-only "select max(version) from supabase_migrations.schema_migrations;"

# 僅在已審查增量 SQL 與備份完成後：
supabase db query --remote=chnvwziuqcqnllcjqobj --file <已審查的增量交易SQL路徑> --yes

# 專用應用 Session 驗證在 handler 中實作，保留既有部署旗標：
supabase functions deploy data-api --remote=chnvwziuqcqnllcjqobj --no-verify-jwt --use-api --yes

# 執行 build 前核對腳本解析的 output 是當前 repo/cloudflare-public。
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-cloudflare-frontend.ps1
npx wrangler@4.152.0 deploy --dry-run --config wrangler.toml
npx wrangler@4.152.0 deploy --config wrangler.toml --message "本次功能與資料保護摘要"
```

Shell 命令的 `<…>` 是說明用占位符，實際執行要替換成已確認路徑，不要原樣貼入。只改前端不用重部署未變 API；只改 data-api 不要順便發布 flights／storage-api。

R2 Worker 只有在其程式／設定確實改動時另用 `--config wrangler.storage.toml` 部署；不能用該設定覆蓋前端，也不要重新建立現有 bucket。flight 服務依獨立變更範圍另行部署並保留其現有存取規則。

有 `?v=` 的 JS／CSS 在 Cloudflare 設為一年 immutable。修改任何該資產必須同時改 `index.html` 對應版本，不可沿用舊 URL。資產輸出不要手動改後漏回原始碼。

發布後確認首頁與功能 JS 版號、角色隔離、原駕駛歷程／文件／保險日期、修改範圍內工作流及手機 320／390／768／1440px。檢查照片頁「開始」可能真的領取任務；正式驗證不可點實際任務造成業務狀態變更。必要測試用短效 Session／合成資料須完成清理，從不寫進 Git。

回復應用程式版本與回復資料是兩件事。不能為回退 UI 把幾天前的 SQL 全庫還原，抹除期間新增資料；先評估相容性，針對確認範圍修復。未經明確授權不刪表、清空資料或覆蓋歷史。

## 9. 環境變數及外部服務設定（只有名稱／用途）

| 所在 | 名稱 | 設定方式／用途 |
| --- | --- | --- |
| 公開 `AFIDE_CONFIG` | `SUPABASE_URL`、`DATA_API_URL`、`FLIGHT_INFO_URL`、`STORAGE_API_URL` | `config.js`；端點可公開，正式 storage 使用同源 `/api/storage` |
| 公開 LINE 識別 | `LIFF_ID`、`LINE_CHANNEL_ID` | `config.js`，對應公司 LINE Developers 應用；網域／LIFF callback 需一起設定 |
| Supabase Functions | `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY` | Supabase 提供／Dashboard Secrets；服務端使用，絕不傳給瀏覽器 |
| data-api secret | `ADMIN_ACCESS_CODE` | 最高管理員驗證來源；既有值不抄入文件，不擅自旋轉 |
| LINE secrets | `LINE_CHANNEL_ACCESS_TOKEN`、`LINE_LOGIN_CHANNEL_ID`（或 `LINE_CHANNEL_ID`） | Supabase Function Secrets；通知及身分驗證使用 |
| 衛星犬 secrets | `EUP_COMPANY_CODE`、`EUP_ACCOUNT`、`EUP_PASSWORD` | Supabase Function Secrets；伺服器查詢，不能放前端或文件 |
| TDX secrets | `TDX_CLIENT_ID`、`TDX_CLIENT_SECRET` | flights Function Secrets；沒有設定時不能假設所有來源可用 |
| R2 Worker | `SUPABASE_URL`、`STORAGE_QUOTA_BYTES` | `wrangler.storage.toml` vars；容量目前設定 10 GiB |
| R2 Worker secrets | `SUPABASE_SERVICE_ROLE_KEY`、`FILE_SIGNING_SECRET` | Cloudflare Secrets／`wrangler secret put <名稱> --config wrangler.storage.toml`，不要將值列在命令列或提交 |
| Worker bindings | `ASSETS`、`STORAGE`、`ATTACHMENTS` | 分別為前端資產、既有附件 Worker、私有 R2 bucket；非一般文字 secret |
| 舊 storage-api | `STORAGE_QUOTA_BYTES` | 舊 API 自己的容量設定與預設值，不能拿它推定 R2 容量 |
| 本機預覽 | `FLEET_PREVIEW_PORT`、`FLEET_PREVIEW_DATA` | 指定本機埠、fixture 路徑，不應設定正式資料庫 URL 取代 fixture |
| 本機測試 | `REPORTING_PREVIEW_DB`、`INSPECTION_PREVIEW_DB`、`INSPECTION_PREVIEW_FILES`、`NODE_PATH` | 記憶體／磁碟測試庫、照片測試目錄、JS 測試依賴路徑 |

其他服務：機場公開航班資料、Open-Meteo 天氣、OpenStreetMap／Leaflet、jsDelivr／cdnjs 的 XLSX／OCR／截圖函式庫。Google Drive 若要新增同步需另外設計 OAuth／權限、增量／稽核及失敗處理，不能把目前連結當成已有同步服務。

GitHub／Cloudflare／Supabase 的帳號授權以各新帳號個別邀請為原則；不要搬 `.wrangler`、CLI credential store、瀏覽器 profile、Session、舊帳號登入碼。根目錄目前沒有已追蹤的通用 `.env` 模板；不要將所有服務 secrets 蒐集到公開 repo。備份 private 資料夾也不得當成可公開下載包。

## 10. 必須遵守的業務邏輯與計算規則

### 絕不可覆蓋既有車輛資料

- 上傳文件／保單只改該文件與必要保險欄位，不能把 `driver_history`、`current_driver_id`、`vehicle_files`、指派駕駛或其他車輛欄位變成空值。
- 不使用載入不完整的整筆物件做廣泛 upsert；省略欄位不是清空指令，明確清空與未提供必須分開。既有保護及 expected revision／updated_at 必須保留。
- 內部借還車只是內部小紀錄，不改正式駕駛與駕駛歷程。
- 正式資料勝過舊站與本機 fixture；資料遷移以 stable ID／車牌／來源證據差異比對，不做整庫覆蓋。

### 保養／調胎與工單

流程：上傳加油里程 → 系統預測 → 管理員手動排程 → 保養日曆 → 通知司機（含內容與廠商）→ 司機點完成 → 更新完成狀態／預測 → 車輛履歷提示待補工單 → 管理員實際登錄工單。

- 舊系統基準放 `fleet_service_baselines`，與 `vehicle_service_records` 真實工單分離；司機完成確認也不自動製造工單。
- 廠商來源以廠商管理 `insurance_partners` 分類資料為準；安排預設目前駕駛，管理員可以改派，不能建立互不相干的第二套名單。
- 加油有效讀數至少 3 筆、跨度至少 7 天才計日均；採 21 天指數衰減權重。日均為各段公里加權總和／天數加權總和，四捨五入至小數 1 位。
- 預測里程＝最近可信里程＋日均×距今天數，四捨五入；加油資料超過 30 天或未來日期不外推。可疑／倒退里程不直接算出誤導預測，保留資料待核對。
- 保養預設間距 10,000 km、調胎 20,000 km，已有明確下次里程優先；剩餘 ≤0 為已達里程，≤500 km 或預估 ≤7 天為即將到期。
- 有排程優先顯示排程；過期未完成顯示「排程已過期，請改排」，不並列互相矛盾的建議日期。

### 工單類型與稅金

- 類型可複選，每個零件也有類型；同一類型全系統顏色一致。對外顯示送修原因與實際維修。
- 上方明細總和為輸入金額 S。未稅：net=S、tax=round(S×5%)、gross=net+tax。含稅：gross=S、net=round(S/1.05)、tax=gross−net。
- S=3650：未稅輸入 → 未稅3650／稅183／含稅3833；含稅輸入 → 未稅3476／稅174／含稅3650。列表及編輯當下都須一致。
- 防連點、同車同日相同項目重複及資料庫版本檢查都不可移除。

### 報班

- 司機資格受所屬車商權限與狀態控管；既有預設為亞菲得股份有限公司且跑趟中／待上線，歷史報班仍須可追溯，不因資格異動刪除舊紀錄。
- 當月開放期間、禁休日、多組區間限休均在後端檢查；區間重疊需同時滿足，0 天代表整段禁休。每月預設 4 天，超額可送出待督導審核，與區間硬性上限不同。
- 司機送出即鎖定，已核准綠色、待審核紅色；一般設定不能覆蓋已送出的休假。
- 授權後台可以日曆編輯該月份，不受上述限制，但保存原審核結果、送出時間、修改前後及操作者。此為個別例外，不取消其他司機的一般規則。

### 車輛檢查

- 10 個位置＝外觀四邊＋四角、駕駛座往後拍室內、儀表里程；拍攝壓縮後上傳，保留照片版本，全部完成才能送出。
- 同車雙司機共享一筆任務，兩人可見，首次開始者領取，另一位不能混拍／送出；兩人都能看通過結果。
- 退回只允許指定角度補拍；完成／送出／非本人領取時不能任意改照片。
- 日期批號採台北日期＋當日序號；取消停止未完成任務，已通過保留。刪除為可復原隱藏，照片／稽核不物理刪除；復原不會順便取消原取消狀態。

### 其他權限與呈現

- 車商只能查自家資料與指派自己資料庫司機；匯入司機空白就是待指派，不因電話存在就任意推定人員。
- 罰單自繳期限／繳款期限、零金額、里程異常需走既有校驗／人工核對，不靜默修改或丟棄來源。
- 一律以 Asia/Taipei 解讀業務日期；報表沒資料顯示缺值，不把未知當零。分鐘是累計時間，可超過 24 小時，不可用當天時鐘截斷。
- 手機避免重複大標題／統計阻擋列表；Modal 的儲存／編輯不可被聊天浮鈕蓋住，側欄保留捲動位置。
- 航班至少沿用十分鐘共用查詢快取，不因進頁自動撈全部；不得為方便刷新而增加流量。

## 11. 已知風險與下一階段建議

以下是依實際檔案及歷史證據整理的工作，不代表全部是目前可重現的線上錯誤：

1. **公開 repo 與歷史資訊**：早期文件／Git 歷史曾出現敏感驗證資訊的風險，不能以目前檔案沒值就宣稱所有歷史安全。應另做 secret／歷史掃描及帳號權限盤點；已暴露的憑證按確認範圍輪換，不能把值抄進 issue 或本文件，也不能擅自重寫 Git 歷史。
2. **依賴可重現性**：補根目錄受控開發依賴 manifest／lockfile、統一測試命令與 CI，逐步取消 `.fleet-preview` 硬編碼依賴路徑；目前給定安裝步驟可接續，不必先重建架構。
3. **新機啟動與遷移缺口**：正式新庫不等於執行早期 schema 即可；需要完整 migration 依賴驗證、附件備份／還原與服務設定。Go 2 切換應獨立規劃演練、增量同步、回復及可用性，不能直接代替目前雲端。
4. **效能／維護成本**：`app.js` 是大型單檔，逐功能測試後拆分，不做一次性改框架。保留 scope load、分頁、快取、避免重複查詢與輪詢；改版需實測，不宣稱文件更新會讓系統變快。
5. **外部來源／舊站**：舊車務資料後續更新需差異核對；Google Drive 持續同步未完成；第三方航班／衛星犬／CDN 可失效，要保留 timeout／錯誤提示及來源時間。
6. **部署可觀測性與復原**：私人演練腳本及備份不在 clone 內；可將去識別化備份校驗／部署流程另整理成可維護工具，仍不能公開原始資料。前端、資料庫、函式與物件儲存需各自有版本及還原策略。
7. **原主目錄未追蹤檔案**：`desktop/dist/`、`desktop/package-lock.json`、`tmp/` 等待持有人分類；可能是必要產物或私人備份，不能擅自刪除或加入 Git。

建議接續順序：先完成新帳號 clone＋合成預覽＋關鍵測試 → 盤點服務權限與備份存取 → 以當前正式資料差異確認使用者下一個需求 → 小範圍增量修改與回歸 → 備份、部署、資料保留查核。不要先清資料或建立全新產品取代既有系統。

## 12. 安全移交給另一個 ChatGPT Business 帳號

1. 讓新帳號在已取得公司授權的電腦／工作區 clone 同一 repo，先讀本文件及 `AGENTS.md`，以 `git log -1` 確認包含交接文件提交。不同電腦路徑可不同，不能照抄原機絕對路徑。
2. 舊 Codex 對話、私人資料夾及 CLI 身分不會自動移交。新帳號不用舊對話即可從本文件和程式碼接續；需要具體歷史決策時再讀 `docs/` 最新發布紀錄。
3. GitHub 可 clone 不代表可 push。另授予適當的公司 GitHub repo 權限；正式管理需另邀請 Cloudflare 與 Supabase 權限，並以新帳號登入 CLI。不要共用舊帳號密碼／Token。
4. 原始碼與規範經 Git 移交；必要備份、附件及使用者檔案經公司核准的加密／受限管道獨立交付，先分類，不上傳公開 repo 或聊天。預覽可先用合成資料，不必為啟動就搬個資。
5. 接手先執行 `git status --short --branch`、`git worktree list`、`git fetch origin`、`git log -1`、`git rev-list --left-right --count HEAD...origin/main`。共享原機時保留既有 worktree 與未追蹤資料，不重設或清理。
6. 完成新環境驗證後，記錄服務授權持有人、備份位置與可還原證據，明確約定後續發布範圍；不直接在正式 UI 以實際司機／車輛測試會改狀態的流程。

### 新 Codex 起始指令範本

> 請先讀 PROJECT_HANDOVER.md、AGENTS.md 與最新 docs 發布紀錄，實際確認 Git／worktree／未提交及未推送差異。延續此 HEYCAR 系統，不重建，不覆蓋正式或私人資料。先用合成 fixture 跑本機預覽及相關測試，再依我的新需求增量修改。任何正式資料操作前先確認當下 schema、備份、差異、工作流與既有資料保護；不要使用文件中的歷史快照覆蓋正式環境。憑證由授權的外部設定提供，不寫入 Git 或聊天。

## 13. 相關現行發布文件

- `docs/production-release-20261117.md`：正式整合、舊資料接入與資料保護。
- `docs/mobile-workflows-release-20261118.md`：頭像、報班、限休、共用車檢查。
- `docs/admin-leave-and-inspection-batches-20261118.md`：最新管理日曆及檢查批次。
- `docs/driver-reporting.md`、`docs/vehicle-inspections-and-loans-20261117.md`：功能規格，須搭配後續發布修訂。
- `docs/local-update-and-production-rollback-20261113.md`：舊回退事件，只作事故背景，不再代表當前僅本機狀態。

本文件描述查核時點，不是未來永遠有效的版本清單；功能／部署／資料策略改動後應同步維護此文件與對應發布紀錄。

正式前端版本：e5692c17-df7d-427c-af30-7807f5d413ac；20261123-12 五項資產下載雜湊一致。data-api 已部署，R2 服務未變。

2026-11-24 正式發布：前端 86f9f6d2-f059-4a86-b24c-7e7b1f22b742、資產 20261124-4；六檔雜湊與測試來源一致。data-api 與增量 migration 已發布；R2 服務未變。正式唯讀驗證通過，臨時檢查 Session 已清除。

正式前端 a6a67e77-7ea3-4e5d-abfb-e198a3050922；資產 20261124-5，六檔正式下載雜湊與測試來源一致。純前端，未部署 data-api／R2 或更動資料庫。
