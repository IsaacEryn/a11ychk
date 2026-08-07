# 명도 대비 오탐 실험 — 라벨링 리포트 (파일럿)

조건: base=RM꺼짐·폰트차단 / rm=RM켜짐·폰트차단(현행) / font=RM꺼짐·폰트허용 / rm+font=RM켜짐·폰트허용
라벨 기준: 해당 요소의 **안정 상태(애니메이션 종료·실제 폰트)** 대비가 기준(일반 4.5:1, 대형 3:1)을 충족하면 → 자동 보고는 **오탐**. 충족하지 못하면 **진탐**.

| 사이트 | base | rm | font | rm+font |
|---|---|---|---|---|
| site-CS | 실패 | 실패 | 실패 | 실패 |
| site-BI | 0 | 0 | 0 | 0 |
| site-AH | 19 | 19 | 19 | 19 |
| site-AR | 4 | 4 | 4 | 4 |
| site-CH | 0 | 0 | 0 | 0 |
| site-CJ | 실패 | 실패 | 실패 | 실패 |
| site-AM | 4 | 8 | 2 | 2 |
| site-V | 1 | 1 | 1 | 1 |
| site-DE | 2 | 2 | 2 | 2 |
| site-AP | 0 | 0 | 0 | 0 |
| site-AE | 3 | 3 | 3 | 3 |
| site-L | 3 | 3 | 2 | 2 |
| site-BV | 0 | 0 | 0 | 0 |
| site-BX | 5 | 5 | 5 | 5 |
| site-BU | 0 | 0 | 0 | 0 |
| site-BE | 18 | 18 | 16 | 16 |
| site-CD | 0 | 0 | 0 | 0 |
| site-AA | 0 | 0 | 0 | 0 |
| site-BD | 11 | 11 | 11 | 11 |
| site-DN | 21 | 21 | 21 | 21 |
| site-DK | 190 | 190 | 190 | 192 |
| site-BL | 0 | 0 | 6 | 1 |
| site-DJ | 77 | 79 | 72 | 80 |
| site-BS | 1 | 1 | 1 | 1 |

## site-AM
### 폰트 허용으로 사라진 위반 (폰트 폴백 기인 오탐 후보) (2건)
- [ ] 오탐 / [ ] 진탐 — `el-14` · 발생률 4/5
  - 색상 #407fd7 on #ecf4ff (대비 3.62), 10.5pt (14px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-15` · 발생률 5/5
  - 색상 #d85b54 on #ffeae8 (대비 3.28), 10.5pt (14px) / weight normal
  - `(생략)`
### RM 적용 시 새로 생긴 위반 (미탐 위험 점검) (4건)
- [ ] 오탐 / [ ] 진탐 — `el-10` · 발생률 3/5
  - 색상 #7e7e7e on #ffffff (대비 4.05), 12.0pt (16px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-11` · 발생률 3/5
  - 색상 #7e7e7e on #ffffff (대비 4.05), 12.0pt (16px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-12` · 발생률 3/5
  - 색상 #7e7e7e on #ffffff (대비 4.05), 12.0pt (16px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-13` · 발생률 3/5
  - 색상 #7e7e7e on #ffffff (대비 4.05), 12.0pt (16px) / weight normal
  - `(생략)`

## site-L
### 폰트 허용으로 사라진 위반 (폰트 폴백 기인 오탐 후보) (1건)
- [ ] 오탐 / [ ] 진탐 — `el-8` · 발생률 5/5
  - 색상 #7c7c7c on #ffffff (대비 4.17), 15.0pt (20px) / weight normal
  - `(생략)`

## site-BE
### 폰트 허용으로 사라진 위반 (폰트 폴백 기인 오탐 후보) (2건)
- [ ] 오탐 / [ ] 진탐 — `el-16` · 발생률 2/5
  - 색상 #272e3c on #000919 (대비 1.46), 10.5pt (14px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-17` · 발생률 2/5
  - 색상 #272e3c on #000919 (대비 1.46), 10.5pt (14px) / weight bold
  - `(생략)`

## site-BL
### 폰트 허용 시 새로 생긴 위반 (미탐 위험 점검) (6건)
- [ ] 오탐 / [ ] 진탐 — `el-23` · 발생률 1/5
  - 색상 #7a7a7a on #ffffff (대비 4.29), 10.5pt (14px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-24` · 발생률 1/5
  - 색상 #7a7a7a on #ffffff (대비 4.29), 10.5pt (14px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-25` · 발생률 1/5
  - 색상 #7a7a7a on #ffffff (대비 4.29), 10.5pt (14px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-26` · 발생률 1/5
  - 색상 #7a7a7a on #ffffff (대비 4.29), 10.5pt (14px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-27` · 발생률 1/5
  - 색상 #7a7a7a on #ffffff (대비 4.29), 10.5pt (14px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-28` · 발생률 1/5
  - 색상 #949494 on #ffffff (대비 3.03), 7.5pt (10px) / weight normal
  - `(생략)`

## site-DJ
### RM 적용으로 사라진 위반 (애니메이션 기인 오탐 후보) (8건)
- [ ] 오탐 / [ ] 진탐 — `el-67` · 발생률 1/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-68` · 발생률 1/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-69` · 발생률 1/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-70` · 발생률 1/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-71` · 발생률 1/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-72` · 발생률 1/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-73` · 발생률 1/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-74` · 발생률 1/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
### 폰트 허용으로 사라진 위반 (폰트 폴백 기인 오탐 후보) (15건)
- [ ] 오탐 / [ ] 진탐 — `el-85` · 발생률 3/5
  - 색상 #6699cc on #ffffff (대비 3), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-86` · 발생률 3/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-87` · 발생률 3/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-88` · 발생률 3/5
  - 색상 #6699cc on #ffffff (대비 3), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-89` · 발생률 3/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-90` · 발생률 3/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-91` · 발생률 3/5
  - 색상 #6699cc on #ffffff (대비 3), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-92` · 발생률 3/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-93` · 발생률 3/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-94` · 발생률 3/5
  - 색상 #6699cc on #ffffff (대비 3), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-95` · 발생률 3/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-96` · 발생률 3/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-97` · 발생률 2/5
  - 색상 #6699cc on #ffffff (대비 3), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-98` · 발생률 2/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-99` · 발생률 2/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
### RM 적용 시 새로 생긴 위반 (미탐 위험 점검) (10건)
- [ ] 오탐 / [ ] 진탐 — `el-75` · 발생률 3/5
  - 색상 #6699cc on #ffffff (대비 3), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-76` · 발생률 3/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-77` · 발생률 3/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-78` · 발생률 1/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-79` · 발생률 1/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-80` · 발생률 1/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-81` · 발생률 1/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-82` · 발생률 1/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-83` · 발생률 1/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-84` · 발생률 1/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
### 폰트 허용 시 새로 생긴 위반 (미탐 위험 점검) (10건)
- [ ] 오탐 / [ ] 진탐 — `el-75` · 발생률 3/5
  - 색상 #6699cc on #ffffff (대비 3), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-76` · 발생률 3/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-77` · 발생률 3/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-78` · 발생률 2/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-79` · 발생률 2/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-80` · 발생률 2/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-81` · 발생률 2/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-82` · 발생률 2/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-83` · 발생률 2/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `el-84` · 발생률 2/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`

