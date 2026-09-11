# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: m6-reporting-obligations.spec.ts >> owner approves, packages, and records a local manual stage filing
- Location: e2e/m6-reporting-obligations.spec.ts:43:1

# Error details

```
Test timeout of 45000ms exceeded.
```

```
Error: page.waitForEvent: Test timeout of 45000ms exceeded.
=========================== logs ===========================
waiting for event "download"
============================================================
```

# Page snapshot

```yaml
- generic [active] [ref=f2e1]:
  - generic [ref=f2e3]:
    - complementary [ref=f2e4]:
      - generic [ref=f2e5]:
        - generic [ref=f2e6]:
          - link "CRA Sentinel" [ref=f2e7] [cursor=pointer]:
            - /url: /dashboard
            - generic [ref=f2e8]: C
            - text: CRA Sentinel
          - button "Collapse sidebar" [ref=f2e9] [cursor=pointer]
        - navigation "Main" [ref=f2e12]:
          - generic [ref=f2e13]:
            - list [ref=f2e15]:
              - listitem [ref=f2e16]:
                - link "Dashboard" [ref=f2e17] [cursor=pointer]:
                  - /url: /dashboard
              - listitem [ref=f2e25]:
                - link "Management" [ref=f2e26] [cursor=pointer]:
                  - /url: /management
              - listitem [ref=f2e32]:
                - link "Organization" [ref=f2e33] [cursor=pointer]:
                  - /url: /organization
              - listitem [ref=f2e40]:
                - link "Products" [ref=f2e41] [cursor=pointer]:
                  - /url: /products
              - listitem [ref=f2e48]:
                - link "Findings" [ref=f2e49] [cursor=pointer]:
                  - /url: /findings
              - listitem [ref=f2e54]:
                - link "Reporting" [ref=f2e55] [cursor=pointer]:
                  - /url: /reporting
              - listitem [ref=f2e61]:
                - link "Connectors" [ref=f2e62] [cursor=pointer]:
                  - /url: /connectors
            - generic [ref=f2e69]:
              - paragraph [ref=f2e70]: Account & access
              - list [ref=f2e71]:
                - listitem [ref=f2e72]:
                  - button "Profile" [ref=f2e73] [cursor=pointer]
                  - generic:
                    - list:
                      - listitem [ref=f2e81]:
                        - link "Account" [ref=f2e82] [cursor=pointer]:
                          - /url: /account
                      - listitem [ref=f2e84]:
                        - link "Security" [ref=f2e85] [cursor=pointer]:
                          - /url: /security
                - listitem [ref=f2e87]:
                  - button "Authorization" [ref=f2e88] [cursor=pointer]
                  - generic:
                    - list:
                      - listitem [ref=f2e96]:
                        - link "Roles" [ref=f2e97] [cursor=pointer]:
                          - /url: /roles
                      - listitem [ref=f2e99]:
                        - link "Permissions" [ref=f2e100] [cursor=pointer]:
                          - /url: /permissions
        - button "Sign out" [ref=f2e104] [cursor=pointer]
    - generic [ref=f2e109]:
      - banner [ref=f2e110]:
        - navigation "Breadcrumb" [ref=f2e112]:
          - list [ref=f2e113]:
            - listitem [ref=f2e114]:
              - link "Dashboard" [ref=f2e115] [cursor=pointer]:
                - /url: /dashboard
            - listitem [ref=f2e116]
            - listitem [ref=f2e119]:
              - generic [ref=f2e120]: Reporting
        - link "Reporting deadline 5 overdue" [ref=f2e122] [cursor=pointer]:
          - /url: /reporting?obligationId=ae25edb2-e66b-4ab6-a5a9-34f80e59d9c8
          - generic [ref=f2e123]: Reporting deadline
          - generic [ref=f2e124]: 5 overdue
        - generic [ref=f2e125]:
          - button "Search" [ref=f2e126] [cursor=pointer]
          - button "Notifications" [ref=f2e130] [cursor=pointer]
          - generic [ref=f2e134]:
            - generic [ref=f2e135]: AF
            - 'img "Ada Foster: online" [ref=f2e137]'
      - main [ref=f2e138]:
        - generic [ref=f2e139]:
          - generic [ref=f2e141]:
            - heading "Reporting obligations" [level=1] [ref=f2e142]
            - paragraph [ref=f2e143]: Track CRA reporting timers from human-asserted awareness, frozen rule versions, and durable anchor corrections.
          - generic [ref=f2e145]:
            - status [ref=f2e146]: Early Warning · Sep 10, 2026, 04:03 PM GMT+5:30
            - paragraph [ref=f2e147]: Deadline reached; refreshing status… · 100% elapsed
            - paragraph [ref=f2e148]: 5 overdue reporting deadlines.
          - generic [ref=f2e149]:
            - heading "Open obligation" [level=2] [ref=f2e150]
            - generic [ref=f2e151]:
              - generic [ref=f2e152]:
                - text: Obligation type
                - combobox "Obligation type" [ref=f2e153] [cursor=pointer]:
                  - option "Actively exploited vulnerability" [selected]
                  - option "Severe incident"
              - generic [ref=f2e154]:
                - text: Awareness time
                - textbox "Awareness time" [ref=f2e157]: 2026-09-11T12:01
              - generic [ref=f2e158]:
                - text: Source
                - combobox "Source" [ref=f2e159] [cursor=pointer]:
                  - option "Manual" [selected]
                  - option "From finding"
            - generic [ref=f2e160]:
              - text: Awareness basis
              - textbox "Awareness basis" [ref=f2e161]:
                - /placeholder: Record the human assertion and evidence basis. This is distinct from creation time.
            - generic [ref=f2e162]:
              - button "Open obligation" [ref=f2e163] [cursor=pointer]
              - generic [ref=f2e164]: 0/4,000
          - generic [ref=f2e165]:
            - table [ref=f2e167]:
              - rowgroup [ref=f2e168]:
                - row [ref=f2e169]:
                  - columnheader "Type" [ref=f2e170]
                  - columnheader "Status" [ref=f2e171]
                  - columnheader "Next deadline" [ref=f2e172]
                  - columnheader "Version" [ref=f2e173]
              - rowgroup [ref=f2e174]:
                - row [ref=f2e175]:
                  - cell [ref=f2e176]:
                    - button "Actively exploited vulnerability" [ref=f2e177] [cursor=pointer]
                    - paragraph [ref=f2e178]: Awareness Sep 11, 2026, 12:01 PM GMT+5:30
                  - cell "active" [ref=f2e179]
                  - cell "Early Warning · Sep 12, 2026, 12:01 PM GMT+5:30" [ref=f2e183]
                  - cell "1" [ref=f2e184]
                - row [ref=f2e185]:
                  - cell [ref=f2e186]:
                    - button "Actively exploited vulnerability" [ref=f2e187] [cursor=pointer]
                    - paragraph [ref=f2e188]: Awareness Sep 11, 2026, 11:49 AM GMT+5:30
                  - cell "active" [ref=f2e189]
                  - cell "Early Warning · Sep 12, 2026, 11:49 AM GMT+5:30" [ref=f2e193]
                  - cell "1" [ref=f2e194]
                - row [ref=f2e195]:
                  - cell [ref=f2e196]:
                    - button "Actively exploited vulnerability" [ref=f2e197] [cursor=pointer]
                    - paragraph [ref=f2e198]: Awareness Sep 11, 2026, 11:47 AM GMT+5:30
                  - cell "active" [ref=f2e199]
                  - cell "Early Warning · Sep 12, 2026, 11:47 AM GMT+5:30" [ref=f2e203]
                  - cell "1" [ref=f2e204]
                - row [ref=f2e205]:
                  - cell [ref=f2e206]:
                    - button "Actively exploited vulnerability" [ref=f2e207] [cursor=pointer]
                    - paragraph [ref=f2e208]: Awareness Sep 11, 2026, 11:47 AM GMT+5:30
                  - cell "active" [ref=f2e209]
                  - cell "Early Warning · Sep 12, 2026, 11:47 AM GMT+5:30" [ref=f2e213]
                  - cell "1" [ref=f2e214]
                - row [ref=f2e215]:
                  - cell [ref=f2e216]:
                    - button "Actively exploited vulnerability" [ref=f2e217] [cursor=pointer]
                    - paragraph [ref=f2e218]: Awareness Sep 11, 2026, 11:47 AM GMT+5:30
                  - cell "active" [ref=f2e219]
                  - cell "Early Warning · Sep 12, 2026, 11:47 AM GMT+5:30" [ref=f2e223]
                  - cell "1" [ref=f2e224]
                - row [ref=f2e225]:
                  - cell [ref=f2e226]:
                    - button "Actively exploited vulnerability" [ref=f2e227] [cursor=pointer]
                    - paragraph [ref=f2e228]: Awareness Sep 11, 2026, 11:44 AM GMT+5:30
                  - cell "active" [ref=f2e229]
                  - cell "Early Warning · Sep 12, 2026, 11:44 AM GMT+5:30" [ref=f2e233]
                  - cell "1" [ref=f2e234]
                - row [ref=f2e235]:
                  - cell [ref=f2e236]:
                    - button "Actively exploited vulnerability" [ref=f2e237] [cursor=pointer]
                    - paragraph [ref=f2e238]: Awareness Sep 11, 2026, 11:41 AM GMT+5:30
                  - cell "active" [ref=f2e239]
                  - cell "Early Warning · Sep 12, 2026, 11:41 AM GMT+5:30" [ref=f2e243]
                  - cell "1" [ref=f2e244]
                - row [ref=f2e245]:
                  - cell [ref=f2e246]:
                    - button "Actively exploited vulnerability" [ref=f2e247] [cursor=pointer]
                    - paragraph [ref=f2e248]: Awareness Sep 11, 2026, 11:33 AM GMT+5:30
                  - cell "active" [ref=f2e249]
                  - cell "Early Warning · Sep 12, 2026, 11:33 AM GMT+5:30" [ref=f2e253]
                  - cell "1" [ref=f2e254]
                - row [ref=f2e255]:
                  - cell [ref=f2e256]:
                    - button "Actively exploited vulnerability" [ref=f2e257] [cursor=pointer]
                    - paragraph [ref=f2e258]: Awareness Sep 11, 2026, 11:33 AM GMT+5:30
                  - cell "active" [ref=f2e259]
                  - cell "Early Warning · Sep 12, 2026, 11:33 AM GMT+5:30" [ref=f2e263]
                  - cell "1" [ref=f2e264]
                - row [ref=f2e265]:
                  - cell [ref=f2e266]:
                    - button "Actively exploited vulnerability" [ref=f2e267] [cursor=pointer]
                    - paragraph [ref=f2e268]: Awareness Sep 11, 2026, 11:31 AM GMT+5:30
                  - cell "active" [ref=f2e269]
                  - cell "Early Warning · Sep 12, 2026, 11:31 AM GMT+5:30" [ref=f2e273]
                  - cell "1" [ref=f2e274]
                - row [ref=f2e275]:
                  - cell [ref=f2e276]:
                    - button "Actively exploited vulnerability" [ref=f2e277] [cursor=pointer]
                    - paragraph [ref=f2e278]: Awareness Sep 11, 2026, 11:28 AM GMT+5:30
                  - cell "active" [ref=f2e279]
                  - cell "Early Warning · Sep 12, 2026, 11:28 AM GMT+5:30" [ref=f2e283]
                  - cell "1" [ref=f2e284]
                - row [ref=f2e285]:
                  - cell [ref=f2e286]:
                    - button "Actively exploited vulnerability" [ref=f2e287] [cursor=pointer]
                    - paragraph [ref=f2e288]: Awareness Sep 11, 2026, 11:13 AM GMT+5:30
                  - cell "active" [ref=f2e289]
                  - cell "Early Warning · Sep 12, 2026, 11:13 AM GMT+5:30" [ref=f2e293]
                  - cell "1" [ref=f2e294]
                - row [ref=f2e295]:
                  - cell [ref=f2e296]:
                    - button "Actively exploited vulnerability" [ref=f2e297] [cursor=pointer]
                    - paragraph [ref=f2e298]: Awareness Sep 10, 2026, 06:14 PM GMT+5:30
                  - cell "active" [ref=f2e299]
                  - cell "Early Warning · Sep 11, 2026, 06:14 PM GMT+5:30" [ref=f2e303]
                  - cell "1" [ref=f2e304]
                - row [ref=f2e305]:
                  - cell [ref=f2e306]:
                    - button "Actively exploited vulnerability" [ref=f2e307] [cursor=pointer]
                    - paragraph [ref=f2e308]: Awareness Sep 10, 2026, 06:13 PM GMT+5:30
                  - cell "active" [ref=f2e309]
                  - cell "Early Warning · Sep 11, 2026, 06:13 PM GMT+5:30" [ref=f2e313]
                  - cell "1" [ref=f2e314]
                - row [ref=f2e315]:
                  - cell [ref=f2e316]:
                    - button "Actively exploited vulnerability" [ref=f2e317] [cursor=pointer]
                    - paragraph [ref=f2e318]: Awareness Sep 10, 2026, 06:03 PM GMT+5:30
                  - cell "active" [ref=f2e319]
                  - cell "Early Warning · Sep 11, 2026, 06:03 PM GMT+5:30" [ref=f2e323]
                  - cell "1" [ref=f2e324]
                - row [ref=f2e325]:
                  - cell [ref=f2e326]:
                    - button "Actively exploited vulnerability" [ref=f2e327] [cursor=pointer]
                    - paragraph [ref=f2e328]: Awareness Sep 10, 2026, 06:02 PM GMT+5:30
                  - cell "active" [ref=f2e329]
                  - cell "Early Warning · Sep 11, 2026, 06:02 PM GMT+5:30" [ref=f2e333]
                  - cell "1" [ref=f2e334]
                - row [ref=f2e335]:
                  - cell [ref=f2e336]:
                    - button "Actively exploited vulnerability" [ref=f2e337] [cursor=pointer]
                    - paragraph [ref=f2e338]: Awareness Sep 10, 2026, 04:06 PM GMT+5:30
                  - cell "active" [ref=f2e339]
                  - cell "Early Warning · Sep 11, 2026, 04:06 PM GMT+5:30" [ref=f2e343]
                  - cell "1" [ref=f2e344]
                - row [ref=f2e345]:
                  - cell [ref=f2e346]:
                    - button "Actively exploited vulnerability" [ref=f2e347] [cursor=pointer]
                    - paragraph [ref=f2e348]: Awareness Sep 10, 2026, 04:06 PM GMT+5:30
                  - cell "active" [ref=f2e349]
                  - cell "Early Warning · Sep 11, 2026, 04:06 PM GMT+5:30" [ref=f2e353]
                  - cell "1" [ref=f2e354]
                - row [ref=f2e355]:
                  - cell [ref=f2e356]:
                    - button "Actively exploited vulnerability" [ref=f2e357] [cursor=pointer]
                    - paragraph [ref=f2e358]: Awareness Sep 10, 2026, 04:04 PM GMT+5:30
                  - cell "active" [ref=f2e359]
                  - cell "Early Warning · Sep 11, 2026, 04:04 PM GMT+5:30" [ref=f2e363]
                  - cell "1" [ref=f2e364]
                - row [ref=f2e365]:
                  - cell [ref=f2e366]:
                    - button "Actively exploited vulnerability" [ref=f2e367] [cursor=pointer]
                    - paragraph [ref=f2e368]: Awareness Sep 10, 2026, 03:30 PM GMT+5:30
                  - cell "active" [ref=f2e369]
                  - cell "Early Warning · Sep 11, 2026, 03:30 PM GMT+5:30" [ref=f2e373]
                  - cell "1" [ref=f2e374]
                - row [ref=f2e375]:
                  - cell [ref=f2e376]:
                    - button "Actively exploited vulnerability" [ref=f2e377] [cursor=pointer]
                    - paragraph [ref=f2e378]: Awareness Sep 10, 2026, 03:30 PM GMT+5:30
                  - cell "active" [ref=f2e379]
                  - cell "Early Warning · Sep 11, 2026, 03:30 PM GMT+5:30" [ref=f2e383]
                  - cell "1" [ref=f2e384]
                - row [ref=f2e385]:
                  - cell [ref=f2e386]:
                    - button "Actively exploited vulnerability" [ref=f2e387] [cursor=pointer]
                    - paragraph [ref=f2e388]: Awareness Sep 10, 2026, 03:30 PM GMT+5:30
                  - cell "active" [ref=f2e389]
                  - cell "Early Warning · Sep 11, 2026, 03:30 PM GMT+5:30" [ref=f2e393]
                  - cell "1" [ref=f2e394]
                - row [ref=f2e395]:
                  - cell [ref=f2e396]:
                    - button "Actively exploited vulnerability" [ref=f2e397] [cursor=pointer]
                    - paragraph [ref=f2e398]: Awareness Sep 10, 2026, 03:29 PM GMT+5:30
                  - cell "active" [ref=f2e399]
                  - cell "Early Warning · Sep 11, 2026, 03:29 PM GMT+5:30" [ref=f2e403]
                  - cell "1" [ref=f2e404]
                - row [ref=f2e405]:
                  - cell [ref=f2e406]:
                    - button "Actively exploited vulnerability" [ref=f2e407] [cursor=pointer]
                    - paragraph [ref=f2e408]: Awareness Sep 10, 2026, 02:43 PM GMT+5:30
                  - cell "active" [ref=f2e409]
                  - cell "Notification · Sep 13, 2026, 02:43 PM GMT+5:30" [ref=f2e413]
                  - cell "2" [ref=f2e414]
                - row [ref=f2e415]:
                  - cell [ref=f2e416]:
                    - button "Actively exploited vulnerability" [ref=f2e417] [cursor=pointer]
                    - paragraph [ref=f2e418]: Awareness Sep 10, 2026, 02:43 PM GMT+5:30
                  - cell "active" [ref=f2e419]
                  - cell "Notification · Sep 13, 2026, 02:43 PM GMT+5:30" [ref=f2e423]
                  - cell "2" [ref=f2e424]
                - row [ref=f2e425]:
                  - cell [ref=f2e426]:
                    - button "Actively exploited vulnerability" [ref=f2e427] [cursor=pointer]
                    - paragraph [ref=f2e428]: Awareness Sep 10, 2026, 02:42 PM GMT+5:30
                  - cell "active" [ref=f2e429]
                  - cell "Notification · Sep 13, 2026, 02:42 PM GMT+5:30" [ref=f2e433]
                  - cell "2" [ref=f2e434]
                - row [ref=f2e435]:
                  - cell [ref=f2e436]:
                    - button "Actively exploited vulnerability" [ref=f2e437] [cursor=pointer]
                    - paragraph [ref=f2e438]: Awareness Sep 10, 2026, 02:41 PM GMT+5:30
                  - cell "active" [ref=f2e439]
                  - cell "Early Warning · Sep 11, 2026, 02:41 PM GMT+5:30" [ref=f2e443]
                  - cell "1" [ref=f2e444]
                - row [ref=f2e445]:
                  - cell [ref=f2e446]:
                    - button "Actively exploited vulnerability" [ref=f2e447] [cursor=pointer]
                    - paragraph [ref=f2e448]: Awareness Sep 10, 2026, 02:41 PM GMT+5:30
                  - cell "active" [ref=f2e449]
                  - cell "Early Warning · Sep 11, 2026, 02:41 PM GMT+5:30" [ref=f2e453]
                  - cell "1" [ref=f2e454]
                - row [ref=f2e455]:
                  - cell [ref=f2e456]:
                    - button "Actively exploited vulnerability" [ref=f2e457] [cursor=pointer]
                    - paragraph [ref=f2e458]: Awareness Sep 10, 2026, 02:40 PM GMT+5:30
                  - cell "active" [ref=f2e459]
                  - cell "Early Warning · Sep 11, 2026, 02:40 PM GMT+5:30" [ref=f2e463]
                  - cell "1" [ref=f2e464]
                - row [ref=f2e465]:
                  - cell [ref=f2e466]:
                    - button "Actively exploited vulnerability" [ref=f2e467] [cursor=pointer]
                    - paragraph [ref=f2e468]: Awareness Sep 10, 2026, 02:37 PM GMT+5:30
                  - cell "active" [ref=f2e469]
                  - cell "Early Warning · Sep 11, 2026, 02:37 PM GMT+5:30" [ref=f2e473]
                  - cell "1" [ref=f2e474]
                - row [ref=f2e475]:
                  - cell [ref=f2e476]:
                    - button "Actively exploited vulnerability" [ref=f2e477] [cursor=pointer]
                    - paragraph [ref=f2e478]: Awareness Sep 10, 2026, 02:36 PM GMT+5:30
                  - cell "active" [ref=f2e479]
                  - cell "Early Warning · Sep 11, 2026, 02:36 PM GMT+5:30" [ref=f2e483]
                  - cell "1" [ref=f2e484]
                - row [ref=f2e485]:
                  - cell [ref=f2e486]:
                    - button "Actively exploited vulnerability" [ref=f2e487] [cursor=pointer]
                    - paragraph [ref=f2e488]: Awareness Sep 10, 2026, 02:34 PM GMT+5:30
                  - cell "active" [ref=f2e489]
                  - cell "Early Warning · Sep 11, 2026, 02:34 PM GMT+5:30" [ref=f2e493]
                  - cell "1" [ref=f2e494]
                - row [ref=f2e495]:
                  - cell [ref=f2e496]:
                    - button "Actively exploited vulnerability" [ref=f2e497] [cursor=pointer]
                    - paragraph [ref=f2e498]: Awareness Sep 10, 2026, 02:33 PM GMT+5:30
                  - cell "cancelled" [ref=f2e499]
                  - cell "No active timer" [ref=f2e503]
                  - cell "4" [ref=f2e504]
                - row [ref=f2e505]:
                  - cell [ref=f2e506]:
                    - button "Actively exploited vulnerability" [ref=f2e507] [cursor=pointer]
                    - paragraph [ref=f2e508]: Awareness Sep 9, 2026, 06:06 PM GMT+5:30
                  - cell "cancelled" [ref=f2e509]
                  - cell "No active timer" [ref=f2e513]
                  - cell "2" [ref=f2e514]
                - row [ref=f2e515]:
                  - cell [ref=f2e516]:
                    - button "Actively exploited vulnerability" [ref=f2e517] [cursor=pointer]
                    - paragraph [ref=f2e518]: Awareness Sep 9, 2026, 05:55 PM GMT+5:30
                  - cell "cancelled" [ref=f2e519]
                  - cell "No active timer" [ref=f2e523]
                  - cell "4" [ref=f2e524]
                - row [ref=f2e525]:
                  - cell [ref=f2e526]:
                    - button "Actively exploited vulnerability" [ref=f2e527] [cursor=pointer]
                    - paragraph [ref=f2e528]: Awareness Sep 9, 2026, 04:15 PM GMT+5:30
                  - cell "cancelled" [ref=f2e529]
                  - cell "No active timer" [ref=f2e533]
                  - cell "4" [ref=f2e534]
                - row [ref=f2e535]:
                  - cell [ref=f2e536]:
                    - button "Actively exploited vulnerability" [ref=f2e537] [cursor=pointer]
                    - paragraph [ref=f2e538]: Awareness Sep 9, 2026, 04:07 PM GMT+5:30
                  - cell "cancelled" [ref=f2e539]
                  - cell "No active timer" [ref=f2e543]
                  - cell "6" [ref=f2e544]
                - row [ref=f2e545]:
                  - cell [ref=f2e546]:
                    - button "Actively exploited vulnerability" [ref=f2e547] [cursor=pointer]
                    - paragraph [ref=f2e548]: Awareness Sep 9, 2026, 04:12 PM GMT+5:30
                  - cell "active" [ref=f2e549]
                  - cell "Early Warning · Sep 10, 2026, 04:12 PM GMT+5:30" [ref=f2e553]
                  - cell "1" [ref=f2e554]
                - row [ref=f2e555]:
                  - cell [ref=f2e556]:
                    - button "Actively exploited vulnerability" [ref=f2e557] [cursor=pointer]
                    - paragraph [ref=f2e558]: Awareness Sep 9, 2026, 04:10 PM GMT+5:30
                  - cell "active" [ref=f2e559]
                  - cell "Early Warning · Sep 10, 2026, 04:10 PM GMT+5:30" [ref=f2e563]
                  - cell "1" [ref=f2e564]
                - row [ref=f2e565]:
                  - cell [ref=f2e566]:
                    - button "Actively exploited vulnerability" [ref=f2e567] [cursor=pointer]
                    - paragraph [ref=f2e568]: Awareness Sep 9, 2026, 04:09 PM GMT+5:30
                  - cell "active" [ref=f2e569]
                  - cell "Early Warning · Sep 10, 2026, 04:09 PM GMT+5:30" [ref=f2e573]
                  - cell "1" [ref=f2e574]
                - row [ref=f2e575]:
                  - cell [ref=f2e576]:
                    - button "Actively exploited vulnerability" [ref=f2e577] [cursor=pointer]
                    - paragraph [ref=f2e578]: Awareness Sep 9, 2026, 04:05 PM GMT+5:30
                  - cell "active" [ref=f2e579]
                  - cell "Early Warning · Sep 10, 2026, 04:05 PM GMT+5:30" [ref=f2e583]
                  - cell "1" [ref=f2e584]
                - row [ref=f2e585]:
                  - cell [ref=f2e586]:
                    - button "Actively exploited vulnerability" [ref=f2e587] [cursor=pointer]
                    - paragraph [ref=f2e588]: Awareness Sep 9, 2026, 04:03 PM GMT+5:30
                  - cell "active" [ref=f2e589]
                  - cell "Early Warning · Sep 10, 2026, 04:03 PM GMT+5:30" [ref=f2e593]
                  - cell "1" [ref=f2e594]
                - row [ref=f2e595]:
                  - cell [ref=f2e596]:
                    - button "Actively exploited vulnerability" [ref=f2e597] [cursor=pointer]
                    - paragraph [ref=f2e598]: Awareness Sep 9, 2026, 03:52 PM GMT+5:30
                  - cell "cancelled" [ref=f2e599]
                  - cell "No active timer" [ref=f2e603]
                  - cell "4" [ref=f2e604]
                - row [ref=f2e605]:
                  - cell [ref=f2e606]:
                    - button "Actively exploited vulnerability" [ref=f2e607] [cursor=pointer]
                    - paragraph [ref=f2e608]: Awareness Apr 14, 2026, 09:20 AM GMT+5:30
                  - cell "cancelled" [ref=f2e609]
                  - cell "No active timer" [ref=f2e613]
                  - cell "2" [ref=f2e614]
                - row [ref=f2e615]:
                  - cell [ref=f2e616]:
                    - button "Actively exploited vulnerability" [ref=f2e617] [cursor=pointer]
                    - paragraph [ref=f2e618]: Awareness Apr 14, 2026, 09:20 AM GMT+5:30
                  - cell "cancelled" [ref=f2e619]
                  - cell "No active timer" [ref=f2e623]
                  - cell "2" [ref=f2e624]
                - row [ref=f2e625]:
                  - cell [ref=f2e626]:
                    - button "Actively exploited vulnerability" [ref=f2e627] [cursor=pointer]
                    - paragraph [ref=f2e628]: Awareness Apr 14, 2026, 09:20 AM GMT+5:30
                  - cell "cancelled" [ref=f2e629]
                  - cell "No active timer" [ref=f2e633]
                  - cell "2" [ref=f2e634]
                - row [ref=f2e635]:
                  - cell [ref=f2e636]:
                    - button "Actively exploited vulnerability" [ref=f2e637] [cursor=pointer]
                    - paragraph [ref=f2e638]: Awareness Apr 14, 2026, 08:20 AM GMT+5:30
                  - cell "cancelled" [ref=f2e639]
                  - cell "No active timer" [ref=f2e643]
                  - cell "4" [ref=f2e644]
            - complementary [ref=f2e645]:
              - heading "Selected obligation" [level=2] [ref=f2e646]
              - paragraph [ref=f2e647]: a0dfd384-2a7d-4653-9e19-fff057b11ba6
              - generic [ref=f2e648]:
                - generic [ref=f2e649]:
                  - term [ref=f2e650]: Rule version
                  - definition [ref=f2e651]: EU-CRA v1
                - generic [ref=f2e652]:
                  - term [ref=f2e653]: Author
                  - definition [ref=f2e654]: Owner Account
              - list [ref=f2e655]:
                - listitem [ref=f2e656]:
                  - generic [ref=f2e657]:
                    - generic [ref=f2e658]: Early Warning
                    - generic [ref=f2e659]: running
                  - paragraph [ref=f2e662]: Due Sep 12, 2026, 12:01 PM GMT+5:30
                  - paragraph [ref=f2e663]: 23h 58m remaining · 0% elapsed
                  - region [ref=f2e664]:
                    - generic [ref=f2e665]:
                      - generic [ref=f2e666]:
                        - heading "Early Warning draft" [level=3] [ref=f2e667]
                        - paragraph [ref=f2e668]: Release-scoped draft content is saved independently from the submitted stage record.
                      - generic [ref=f2e669]: editable
                    - status [ref=f2e672]: Editing lock acquired. Save before it expires.
                    - group "Draft fields" [ref=f2e673]:
                      - generic [ref=f2e675]:
                        - generic [ref=f2e676]: Initial summary (required)
                        - generic [ref=f2e677]: What happened and why this report is required.
                        - 'textbox "Initial summary (required) What happened and why this report is required. Source: Entered by Owner Account" [ref=f2e678]': "LOCAL-M6-E2E-1789108303560: initial summary."
                        - generic [ref=f2e679]: "Source: Entered by Owner Account"
                      - generic [ref=f2e680]:
                        - generic [ref=f2e681]: Known impact (required)
                        - generic [ref=f2e682]: Known or reasonably suspected impact.
                        - 'textbox "Known impact (required) Known or reasonably suspected impact. Source: Entered by Owner Account" [ref=f2e683]': "LOCAL-M6-E2E-1789108303560: known impact."
                        - generic [ref=f2e684]: "Source: Entered by Owner Account"
                      - generic [ref=f2e685]:
                        - text: Member States (comma-separated ISO codes)
                        - textbox "Member States (comma-separated ISO codes) Corrected states retain their origin in the submitted evidence." [ref=f2e688]: DE
                        - generic [ref=f2e689]: Corrected states retain their origin in the submitted evidence.
                    - generic [ref=f2e690]:
                      - heading "Reusable family template" [level=4] [ref=f2e691]
                      - paragraph [ref=f2e692]: Templates exclude Member States and require review before submission.
                      - generic [ref=f2e693]:
                        - generic [ref=f2e694]:
                          - text: Save current reusable content as
                          - textbox "Save current reusable content as" [ref=f2e697]:
                            - /placeholder: Template name
                        - button "Save template" [disabled] [ref=f2e698]
                    - button "Save draft" [disabled] [ref=f2e700]
                    - generic "Report approval" [ref=f2e701]:
                      - heading "Approval" [level=4] [ref=f2e702]
                      - paragraph [ref=f2e703]: Approve revision 2. The displayed content, provenance, validation state and hash are bound to a single-use fresh reauthentication proof.
                      - paragraph [ref=f2e704]: "Content hash: 1f465f9332047cf20d809cfea44646d97f5c44b92fab450cfb5a93b3716af65b"
                      - generic [ref=f2e705]:
                        - text: Current password
                        - textbox "Current password" [ref=f2e708]
                      - generic [ref=f2e709]:
                        - text: MFA code (if required)
                        - textbox "MFA code (if required)" [ref=f2e712]
                      - generic [ref=f2e713]:
                        - text: Owner override reason (only when approving your own edits)
                        - textbox "Owner override reason (only when approving your own edits)" [ref=f2e716]: The seeded owner is the only authorized responder for this local verification.
                      - generic [ref=f2e717]:
                        - button "Reauthenticate" [disabled] [ref=f2e718]
                        - button "Approve stage" [disabled] [ref=f2e719]
                    - generic "Manual submission package" [ref=f2e720]:
                      - heading "Signed manual package" [level=4] [ref=f2e721]
                      - paragraph [ref=f2e722]: Package generation preserves the approved snapshot. Downloading it does not record an external filing or stop a deadline.
                      - generic [ref=f2e723]:
                        - button "Generate package" [ref=f2e724] [cursor=pointer]
                        - button "Download package" [ref=f2e725] [cursor=pointer]
                      - status [ref=f2e726]: "Package ready: manual-submission-a7d3e5a2-dbaf-4294-a3b7-0c2a78a84207.zip. SHA-256 5ed4a73ec81f635d276c6b8dfbef7d008a7faeb475811ec63526c5861f8b6658."
                    - generic "Record external filing" [ref=f2e727]:
                      - heading "Record external filing" [level=4] [ref=f2e728]
                      - paragraph [ref=f2e729]: Record the actual external filing only after it has occurred. A fresh filing proof and one receipt are required.
                      - generic [ref=f2e730]:
                        - text: External filing reference
                        - textbox "External filing reference" [ref=f2e733]:
                          - /placeholder: Regulator portal or filing reference
                      - generic [ref=f2e734]:
                        - text: Actual filing timestamp (UTC)
                        - textbox "Actual filing timestamp (UTC)" [ref=f2e737]:
                          - /placeholder: 2026-01-31T15:30:00Z
                          - text: 2026-09-11T06:31:44Z
                      - generic [ref=f2e738]:
                        - text: Timestamp basis
                        - textbox "Timestamp basis" [ref=f2e741]:
                          - /placeholder: Portal receipt timestamp in UTC
                      - generic [ref=f2e742]:
                        - text: Receipt (PDF, PNG, JPEG, or text; 10 MiB maximum)
                        - button "Receipt (PDF, PNG, JPEG, or text; 10 MiB maximum)" [ref=f2e745] [cursor=pointer]
                      - generic [ref=f2e746]:
                        - text: Current password
                        - textbox "Current password" [ref=f2e749]
                      - generic [ref=f2e750]:
                        - text: MFA code (if required)
                        - textbox "MFA code (if required)" [ref=f2e753]
                      - generic [ref=f2e754]:
                        - button "Reauthenticate for filing" [disabled] [ref=f2e755]
                        - button "Record external filing" [disabled] [ref=f2e756]
                    - generic "Export reporting evidence" [ref=f2e757]:
                      - heading "Export reporting evidence" [level=4] [ref=f2e758]
                      - paragraph [ref=f2e759]: Export an immutable, manifest-verified evidence pack for this obligation. The export does not alter the reporting record.
                      - generic [ref=f2e760]:
                        - button "Generate evidence pack" [ref=f2e761] [cursor=pointer]
                        - button "Download evidence pack" [disabled] [ref=f2e762]
                    - alert [ref=f2e763]: The draft could not be updated. Review the values and try again.
                - listitem [ref=f2e764]:
                  - generic [ref=f2e765]:
                    - generic [ref=f2e766]: Notification
                    - generic [ref=f2e767]: running
                  - paragraph [ref=f2e770]: Due Sep 14, 2026, 12:01 PM GMT+5:30
                  - paragraph [ref=f2e771]: 71h 58m remaining · 0% elapsed
                  - region [ref=f2e772]:
                    - generic [ref=f2e773]:
                      - generic [ref=f2e774]:
                        - heading "Notification draft" [level=3] [ref=f2e775]
                        - paragraph [ref=f2e776]: Release-scoped draft content is saved independently from the submitted stage record.
                      - generic [ref=f2e777]: missing
                    - generic [ref=f2e780]:
                      - generic [ref=f2e781]:
                        - text: Release ID
                        - textbox "Release ID" [ref=f2e784]:
                          - /placeholder: Release UUID
                      - paragraph [ref=f2e785]: The release determines the default Member States. Confirm it before creating the draft.
                      - button "Create draft" [disabled] [ref=f2e786]
                - listitem [ref=f2e787]:
                  - generic [ref=f2e788]:
                    - generic [ref=f2e789]: Final Report
                    - generic [ref=f2e790]: pending_anchor
                  - paragraph [ref=f2e793]: Due Pending anchor
                  - paragraph [ref=f2e794]: Pending anchor
                  - region [ref=f2e795]:
                    - generic [ref=f2e796]:
                      - generic [ref=f2e797]:
                        - heading "Final Report draft" [level=3] [ref=f2e798]
                        - paragraph [ref=f2e799]: Release-scoped draft content is saved independently from the submitted stage record.
                      - generic [ref=f2e800]: missing
                    - generic [ref=f2e803]:
                      - generic [ref=f2e804]:
                        - text: Release ID
                        - textbox "Release ID" [ref=f2e807]:
                          - /placeholder: Release UUID
                      - paragraph [ref=f2e808]: The release determines the default Member States. Confirm it before creating the draft.
                      - button "Create draft" [disabled] [ref=f2e809]
              - generic [ref=f2e810]:
                - generic [ref=f2e811]:
                  - heading "Correct anchor" [level=3] [ref=f2e812]
                  - generic [ref=f2e813]:
                    - combobox [ref=f2e814] [cursor=pointer]:
                      - option "awareness" [selected]
                      - option "remediation_available"
                    - textbox [ref=f2e817]: 2026-09-11T12:01
                    - textbox "Awareness basis" [ref=f2e820]
                    - textbox "Correction reason" [ref=f2e823]
                    - button "Save correction" [ref=f2e824] [cursor=pointer]
                - generic [ref=f2e825]:
                  - heading "Record submission" [level=3] [ref=f2e826]
                  - generic [ref=f2e827]:
                    - combobox [ref=f2e828] [cursor=pointer]:
                      - option "Early Warning" [selected]
                      - option "Notification"
                      - option "Final Report"
                    - textbox "Submission reference" [ref=f2e831]
                    - generic [ref=f2e832]:
                      - text: Submission time
                      - textbox "Submission time" [ref=f2e835]: 2026-09-11T12:01
                    - button "Record submission" [ref=f2e836] [cursor=pointer]
                - button "Cancel obligation" [disabled] [ref=f2e838]
  - button "Open Next.js Dev Tools" [ref=f2e844] [cursor=pointer]
  - alert [ref=f2e848]
```

# Test source

```ts
  20  |   await page.goto("/dashboard");
  21  |   await expect(page).toHaveURL(/\/dashboard$/);
  22  | 
  23  |   const selected = await page.evaluate(async () => {
  24  |     const sessionResponse = await fetch("/api/v1/auth/session");
  25  |     if (!sessionResponse.ok) return false;
  26  |     const session = (await sessionResponse.json()) as {
  27  |       organizations: Array<{ id: string; role: string }>;
  28  |     };
  29  |     const organization =
  30  |       session.organizations.find((candidate) => candidate.role === "owner") ??
  31  |       session.organizations[0];
  32  |     if (!organization) return false;
  33  |     const switchResponse = await fetch("/api/v1/organizations/switch", {
  34  |       method: "POST",
  35  |       headers: { "content-type": "application/json" },
  36  |       body: JSON.stringify({ organizationId: organization.id }),
  37  |     });
  38  |     return switchResponse.ok;
  39  |   });
  40  |   expect(selected).toBe(true);
  41  | }
  42  | 
  43  | test("owner approves, packages, and records a local manual stage filing", async ({
  44  |   page,
  45  | }, testInfo) => {
  46  |   await signInAsOwner(page);
  47  |   await page.goto("/reporting");
  48  | 
  49  |   await expect(
  50  |     page.getByRole("heading", { name: "Reporting obligations" }),
  51  |   ).toBeVisible();
  52  |   const create = page.locator("form").filter({
  53  |     has: page.getByRole("heading", { name: "Open obligation" }),
  54  |   });
  55  |   const marker = `LOCAL-M6-E2E-${Date.now()}`;
  56  |   await create
  57  |     .getByLabel("Awareness basis")
  58  |     .fill(`${marker}: a human asserted awareness for browser verification.`);
  59  |   const opened = page.waitForResponse(
  60  |     (response) =>
  61  |       response.url().endsWith("/api/v1/reporting/obligations") &&
  62  |       response.request().method() === "POST",
  63  |   );
  64  |   await create.getByRole("button", { name: "Open obligation" }).click();
  65  |   const openedResponse = await opened;
  66  |   expect(openedResponse.status()).toBe(201);
  67  |   const openedBody = (await openedResponse.json()) as {
  68  |     obligation: { id: string };
  69  |   };
  70  |   await page.goto(`/reporting?obligationId=${openedBody.obligation.id}`);
  71  | 
  72  |   const detail = page.getByRole("complementary");
  73  |   await expect(detail.getByText(openedBody.obligation.id, { exact: true })).toBeVisible();
  74  |   const stages = detail.locator("ol");
  75  |   await expect(
  76  |     stages.getByText("Early Warning", { exact: true }),
  77  |   ).toBeVisible();
  78  |   await expect(stages.getByText("Final Report", { exact: true })).toBeVisible();
  79  |   await expect(
  80  |     stages
  81  |       .locator("li")
  82  |       .filter({ hasText: /Early Warning.*remaining.*elapsed/ }),
  83  |   ).toBeVisible();
  84  |   await expect(
  85  |     stages.locator("li").filter({ hasText: /Final Report.*Pending anchor/ }),
  86  |   ).toBeVisible();
  87  | 
  88  |   const draft = detail.locator("section").filter({
  89  |     has: page.getByRole("heading", { name: "Early Warning draft" }),
  90  |   });
  91  |   await expect(draft).toBeVisible();
  92  |   await draft.getByPlaceholder("Release UUID").fill(localReleaseId);
  93  |   await draft.getByRole("button", { name: "Create draft" }).click();
  94  |   await expect(draft.getByRole("button", { name: "Edit draft" })).toBeEnabled();
  95  |   await draft.getByRole("button", { name: "Edit draft" }).click();
  96  |   await expect(draft.getByText("Editing lock acquired.")).toBeVisible();
  97  |   await draft.locator("textarea").nth(0).fill(`${marker}: initial summary.`);
  98  |   await draft.locator("textarea").nth(1).fill(`${marker}: known impact.`);
  99  |   await draft
  100 |     .getByLabel("Member States (comma-separated ISO codes)")
  101 |     .fill("DE");
  102 |   await draft.getByRole("button", { name: "Save draft" }).click();
  103 |   await draft.getByLabel("Current password").fill(ownerPassword!);
  104 |   await draft
  105 |     .getByLabel("Owner override reason (only when approving your own edits)")
  106 |     .fill(
  107 |       "The seeded owner is the only authorized responder for this local verification.",
  108 |     );
  109 |   await draft.getByRole("button", { name: "Reauthenticate" }).click();
  110 |   await expect(draft.getByText("Fresh approval proof ready.")).toBeVisible();
  111 |   await expect(
  112 |     draft.getByRole("button", { name: "Approve stage" }),
  113 |   ).toBeEnabled();
  114 |   await draft.getByRole("button", { name: "Approve stage" }).click();
  115 |   const earlyWarningStage = stages.locator("li").first();
  116 |   await expect(earlyWarningStage.getByText("running", { exact: true })).toBeVisible();
  117 | 
  118 |   await draft.getByRole("button", { name: "Generate package" }).click();
  119 |   await expect(draft.getByText(/Package ready:/)).toBeVisible();
> 120 |   const download = page.waitForEvent("download");
      |                         ^ Error: page.waitForEvent: Test timeout of 45000ms exceeded.
  121 |   await draft.getByRole("button", { name: "Download package" }).click();
  122 |   await (await download).path();
  123 | 
  124 |   await draft
  125 |     .getByLabel("External filing reference")
  126 |     .fill(`${marker}-EXTERNAL-FILING`);
  127 |   await draft
  128 |     .getByLabel("Timestamp basis")
  129 |     .fill("Local regulator portal receipt timestamp in UTC.");
  130 |   await draft
  131 |     .getByLabel("Receipt (PDF, PNG, JPEG, or text; 10 MiB maximum)")
  132 |     .setInputFiles({
  133 |       name: "receipt.txt",
  134 |       mimeType: "text/plain",
  135 |       buffer: Buffer.from(`${marker}: external filing receipt`),
  136 |     });
  137 |   await draft.getByLabel("Current password").last().fill(ownerPassword!);
  138 |   await draft
  139 |     .getByRole("button", { name: "Reauthenticate for filing" })
  140 |     .click();
  141 |   await expect(draft.getByText("Fresh filing proof ready.")).toBeVisible();
  142 |   await draft.getByRole("button", { name: "Record external filing" }).click();
  143 |   await expect(earlyWarningStage.getByText("submitted", { exact: true })).toBeVisible();
  144 | 
  145 |   await page.screenshot({
  146 |     path: testInfo.outputPath("m6-reporting-obligation-desktop.png"),
  147 |     fullPage: true,
  148 |   });
  149 | 
  150 |   await page.setViewportSize({ width: 390, height: 844 });
  151 |   await expect(
  152 |     await page
  153 |       .locator("html")
  154 |       .evaluate((element) => element.scrollWidth <= window.innerWidth),
  155 |   ).toBe(true);
  156 |   await page.screenshot({
  157 |     path: testInfo.outputPath("m6-reporting-obligation-mobile.png"),
  158 |     fullPage: true,
  159 |   });
  160 | });
  161 | 
```