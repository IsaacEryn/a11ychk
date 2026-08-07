# 명도 대비 오탐 실험 — 라벨링 리포트 (파일럿)

조건: base=RM꺼짐·폰트차단 / rm=RM켜짐·폰트차단(현행) / font=RM꺼짐·폰트허용 / rm+font=RM켜짐·폰트허용
라벨 기준: 해당 요소의 **안정 상태(애니메이션 종료·실제 폰트)** 대비가 기준(일반 4.5:1, 대형 3:1)을 충족하면 → 자동 보고는 **오탐**. 충족하지 못하면 **진탐**.

| 사이트 | base | rm | font | rm+font |
|---|---|---|---|---|
| site-B | 0 | 0 | 7 | 0 |
| site-O | 0 | 0 | 0 | 0 |
| site-W | 9 | 9 | 9 | 9 |
| site-BH | 7 | 7 | 7 | 7 |
| site-DO | 0 | 0 | 0 | 0 |
| site-BG | 0 | 0 | 0 | 0 |
| site-T | 22 | 22 | 21 | 21 |
| site-U | 4 | 4 | 4 | 4 |
| site-I | 1 | 1 | 1 | 1 |
| site-CQ | 23 | 23 | 23 | 24 |
| site-AD | 2 | 2 | 2 | 2 |
| site-BJ | 8 | 8 | 10 | 7 |
| site-BY | 0 | 0 | 0 | 0 |
| site-BT | 0 | 0 | 0 | 0 |
| site-BW | 실패 | 실패 | 실패 | 실패 |
| site-CC | 6 | 6 | 6 | 6 |
| site-BF | 0 | 0 | 0 | 0 |
| site-DD | 13 | 16 | 13 | 13 |
| site-BK | 실패 | 실패 | 실패 | 실패 |
| site-CW | 53 | 53 | 53 | 53 |
| site-AT | 46 | 46 | 46 | 46 |
| site-CA | 31 | 31 | 31 | 31 |
| site-CP | 1 | 1 | 1 | 1 |
| site-BN | 14 | 39 | 23 | 23 |
| site-AK | 3 | 3 | 3 | 3 |
| site-Q | 0 | 0 | 0 | 0 |
| site-DH | 0 | 0 | 0 | 0 |
| site-CT | 7 | 7 | 7 | 7 |
| site-CL | 23 | 23 | 23 | 23 |
| site-DG | 31 | 31 | 32 | 32 |

## site-B
### 폰트 허용 시 새로 생긴 위반 (미탐 위험 점검) (7건)
- [ ] 오탐 / [ ] 진탐 — `.transition-transform` · 발생률 1/5
  - 색상 #faf8f3 on #44827a (대비 4.19), 12.0pt (16px) / weight bold · 캡처 shots 참조: shots/_skip/0.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #44827a on #faf8f3 (대비 4.19), 12.0pt (16px) / weight normal · 캡처 shots 참조: shots/_skip/1.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `.rounded-full` · 발생률 1/5
  - 색상 #44827a on #faf8f3 (대비 4.19), 9.0pt (12px) / weight bold · 캡처 shots 참조: shots/_skip/2.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #727975 on #faf8f3 (대비 4.2), 10.5pt (14px) / weight bold · 캡처 shots 참조: shots/_skip/3.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #44827a on #faf8f3 (대비 4.19), 10.5pt (14px) / weight bold · 캡처 shots 참조: shots/_skip/4.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #828c88 on #faf8f3 (대비 3.26), 9.0pt (12px) / weight normal · 캡처 shots 참조: shots/_skip/5.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `.text-center` · 발생률 1/5
  - 색상 #828c88 on #faf8f3 (대비 3.26), 10.5pt (14px) / weight normal · 캡처 shots 참조: shots/_skip/6.jpg
  - `(생략)`

## site-T
### 폰트 허용으로 사라진 위반 (폰트 폴백 기인 오탐 후보) (1건)
- [ ] 오탐 / [ ] 진탐 — `a[href="#"]:nth-child(1)` · 발생률 3/5
  - 색상 #979797 on #404041 (대비 3.54), 9.8pt (13px) / weight normal
  - `<a href="#">교내외주요사이트</a>`

## site-BJ
### 폰트 허용 시 새로 생긴 위반 (미탐 위험 점검) (2건)
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 3/5
  - 색상 #db2230 on #f3f3f6 (대비 4.42), 9.0pt (12px) / weight bold · 캡처 shots 참조: shots/_skip/1.jpg
  - `<i>NEW</i>`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 3/5
  - 색상 #db2230 on #f3f3f6 (대비 4.42), 9.0pt (12px) / weight bold · 캡처 shots 참조: shots/_skip/2.jpg
  - `<i>NEW</i>`

## site-DD
### RM 적용 시 새로 생긴 위반 (미탐 위험 점검) (3건)
- [ ] 오탐 / [ ] 진탐 — `a[href="\/tta\/contents\?contentId\=226"]` · 발생률 1/5
  - 색상 #6d7882 on #f4f5f6 (대비 4.12), 12.0pt (16px) / weight normal · 캡처 shots 참조: shots/_skip/9.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `a[href="\/tta\/contents\?contentId\=224"]` · 발생률 1/5
  - 색상 #6d7882 on #f4f5f6 (대비 4.12), 12.0pt (16px) / weight normal · 캡처 shots 참조: shots/_skip/10.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `a[href="\/tta\/contents\?contentId\=223"]` · 발생률 1/5
  - 색상 #6d7882 on #f4f5f6 (대비 4.12), 12.0pt (16px) / weight normal · 캡처 shots 참조: shots/_skip/11.jpg
  - `(생략)`

## site-BN
### RM 적용 시 새로 생긴 위반 (미탐 위험 점검) (25건)
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #727780 on #f3f5f7 (대비 4.11), 9.8pt (13px) / weight normal · 캡처 shots 참조: shots/site-BN/rm/1.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #ea1917 on #f3f5f7 (대비 4.13), 12.0pt (16px) / weight normal · 캡처 shots 참조: shots/site-BN/rm/2.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #ea1917 on #f3f5f7 (대비 4.13), 14.3pt (19px) / weight normal · 캡처 shots 참조: shots/site-BN/rm/3.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #727780 on #f3f5f7 (대비 4.11), 9.8pt (13px) / weight normal · 캡처 shots 참조: shots/site-BN/rm/4.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #ea1917 on #f3f5f7 (대비 4.13), 12.0pt (16px) / weight normal · 캡처 shots 참조: shots/site-BN/rm/5.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #727780 on #f3f5f7 (대비 4.11), 9.8pt (13px) / weight normal · 캡처 shots 참조: shots/site-BN/rm/6.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #ea1917 on #f3f5f7 (대비 4.13), 12.0pt (16px) / weight normal · 캡처 shots 참조: shots/site-BN/rm/7.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #ea1917 on #f3f5f7 (대비 4.13), 14.3pt (19px) / weight normal · 캡처 shots 참조: shots/site-BN/rm/8.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 2/5
  - 색상 #727780 on #f3f5f7 (대비 4.11), 12.0pt (16px) / weight normal · 캡처 shots 참조: shots/_skip/0.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #727780 on #f3f5f7 (대비 4.11), 9.8pt (13px) / weight normal · 캡처 shots 참조: shots/_skip/2.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #ea1917 on #f3f5f7 (대비 4.13), 12.0pt (16px) / weight normal · 캡처 shots 참조: shots/_skip/3.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #ea1917 on #f3f5f7 (대비 4.13), 14.3pt (19px) / weight normal · 캡처 shots 참조: shots/_skip/4.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #727780 on #f3f5f7 (대비 4.11), 9.8pt (13px) / weight normal · 캡처 shots 참조: shots/_skip/5.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #ea1917 on #f3f5f7 (대비 4.13), 12.0pt (16px) / weight normal · 캡처 shots 참조: shots/_skip/6.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #727780 on #f3f5f7 (대비 4.11), 9.8pt (13px) / weight normal · 캡처 shots 참조: shots/_skip/7.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #ea1917 on #f3f5f7 (대비 4.13), 12.0pt (16px) / weight normal · 캡처 shots 참조: shots/_skip/8.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #ea1917 on #f3f5f7 (대비 4.13), 14.3pt (19px) / weight normal · 캡처 shots 참조: shots/_skip/9.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #727780 on #f3f5f7 (대비 4.11), 9.8pt (13px) / weight normal · 캡처 shots 참조: shots/_skip/2.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #ea1917 on #f3f5f7 (대비 4.13), 12.0pt (16px) / weight normal · 캡처 shots 참조: shots/_skip/3.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #ea1917 on #f3f5f7 (대비 4.13), 14.3pt (19px) / weight normal · 캡처 shots 참조: shots/_skip/4.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #727780 on #f3f5f7 (대비 4.11), 9.8pt (13px) / weight normal · 캡처 shots 참조: shots/_skip/5.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #ea1917 on #f3f5f7 (대비 4.13), 12.0pt (16px) / weight normal · 캡처 shots 참조: shots/_skip/6.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #727780 on #f3f5f7 (대비 4.11), 9.8pt (13px) / weight normal · 캡처 shots 참조: shots/_skip/7.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #ea1917 on #f3f5f7 (대비 4.13), 12.0pt (16px) / weight normal · 캡처 shots 참조: shots/_skip/8.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #ea1917 on #f3f5f7 (대비 4.13), 14.3pt (19px) / weight normal · 캡처 shots 참조: shots/_skip/9.jpg
  - `(생략)`
### 폰트 허용 시 새로 생긴 위반 (미탐 위험 점검) (9건)
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 2/5
  - 색상 #727780 on #f3f5f7 (대비 4.11), 12.0pt (16px) / weight normal · 캡처 shots 참조: shots/site-BN/font/0.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 2/5
  - 색상 #727780 on #f3f5f7 (대비 4.11), 9.8pt (13px) / weight normal · 캡처 shots 참조: shots/site-BN/font/2.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 2/5
  - 색상 #ea1917 on #f3f5f7 (대비 4.13), 12.0pt (16px) / weight normal · 캡처 shots 참조: shots/site-BN/font/3.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 2/5
  - 색상 #ea1917 on #f3f5f7 (대비 4.13), 14.3pt (19px) / weight normal · 캡처 shots 참조: shots/site-BN/font/4.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 2/5
  - 색상 #727780 on #f3f5f7 (대비 4.11), 9.8pt (13px) / weight normal · 캡처 shots 참조: shots/site-BN/font/5.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 2/5
  - 색상 #ea1917 on #f3f5f7 (대비 4.13), 12.0pt (16px) / weight normal · 캡처 shots 참조: shots/site-BN/font/6.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 2/5
  - 색상 #727780 on #f3f5f7 (대비 4.11), 9.8pt (13px) / weight normal · 캡처 shots 참조: shots/site-BN/font/7.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 2/5
  - 색상 #ea1917 on #f3f5f7 (대비 4.13), 12.0pt (16px) / weight normal · 캡처 shots 참조: shots/site-BN/font/8.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 2/5
  - 색상 #ea1917 on #f3f5f7 (대비 4.13), 14.3pt (19px) / weight normal · 캡처 shots 참조: shots/site-BN/font/9.jpg
  - `(생략)`

## site-DG
### 폰트 허용 시 새로 생긴 위반 (미탐 위험 점검) (1건)
- [ ] 오탐 / [ ] 진탐 — `#\:r0\:` · 발생률 1/5
  - 색상 #858688 on #ffffff (대비 3.64), 10.5pt (14px) / weight normal · 캡처 shots 참조: shots/_skip/9.jpg
  - `(생략)`

