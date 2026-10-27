/** Generated from cldr-core 48.2.0 by tools/generate-locale-profile.ts. */

/**
 * The script each language is written in where a tag names none, grouped by script: the
 * languages and the language_region tags of `supplemental/likelySubtags.json` whose likely
 * subtags give that script.
 *
 * 324 languages, the language of every locale CLDR carries and of every set of plural rules it
 * has for a language without a locale, and the 51 language_region tags whose script is not
 * their language's. UTS #35 Part 1 section 4.3 looks up language_region before language, so
 * `zh-TW` is `Hant` where `zh` is `Hans`.
 *
 * The runtime reads it to tell whether the locale a formatter used is written in the script of
 * the locale asked for, to give root as the main parent of a language and a script that
 * language does not usually take, and to read a language_region whose script differs as the
 * language_script_region UTS #35 Part 1, Lookup, aliases it to. The host is not asked, because
 * its likely subtags are its own data and change with it. A language this table does not hold
 * has no data the host could have used in its place, and its script is unknown.
 */
// prettier-ignore
export const LIKELY_SCRIPTS: Readonly<Record<string, string>> = Object.freeze({"Arab":"apc ar ars az-IQ az-IR bal bgn bqi ckb fa ha-CM ha-SD kk-AF kk-CN kk-IR kk-MN ks ku-IQ ku-IR ku-LB ky-CN lrc ms-CC mzn pa-PK ps sd sdh skr tg-PK trw ug ur uz-AF","Armn":"hy","Beng":"as bn mni","Cakm":"ccp","Cans":"csw iu","Cher":"chr","Copt":"cop","Cyrl":"ab az-RU ba be bg bua ce cu cv kaa kk ku-AM ku-AZ ku-GE ku-TM ky mdf mk mn myv os ru sah sr tg tt tyv ug-KZ ug-MN uk uz-CN","Deva":"bgc bho brx doi hi kok mai mr ne pi-IN raj sa sd-IN suz xnr","Ethi":"am byn gez ti tig wal","Geor":"ka lzz-GE","Grek":"el","Gujr":"gu","Guru":"pa","Hans":"yue-CN zh","Hant":"yue zh-AU zh-BN zh-GB zh-GF zh-HK zh-ID zh-MO zh-PA zh-PF zh-PH zh-SR zh-TH zh-TW zh-US zh-VN","Hebr":"he yi","Hmnp":"hnj mww","Jpan":"ja","Khmr":"km","Knda":"kn","Kore":"ko","Laoo":"lo","Latn":"aa af agq ak an ann arn asa ast az bas bem bew bez blo bm br bs bss ca cad cch ceb cgg cho cic co cs cy da dav de dje dsb dua dyo ebu ee en eo es et eu ewo ff fi fil fo fr frr fur fy ga gaa gd gl gn gsw guw guz gv ha haw hr hsb ht hu ia id ie ig io is it jbo jgo jmc jv kab kaj kam kcg kde kea kek ken kgp khq ki kkj kl kln kpe ksb ksf ksh ku kw kxv ky-TR la lag lb lg lij lkt lld lmo ln lt ltg lu luo luy lv lzz mas mer mfe mg mgh mgo mhn mi mic moh ms mt mua mus naq nb nd nds nl nmg nn nnh no nr nso nus nv ny nyn oc oka om pap pcm pi pis pl pms prg pt qu quc rif rm rn ro rof rw rwk saq sbp sc scn se seh ses sg sgs sid sk sl sma smj smn sms sn so sq sr-ME sr-RO sr-TR ss ssy st su sv sw szl teo tk tn to tok tpi tr trv ts twq tzm uz ve vec vi vmw vo vun wa wae wbp wo xh xog yav yo yrl za zu","Mlym":"ml","Mong":"mn-CN","Mymr":"my pi-MM shn","Nkoo":"nqo","Olck":"sat","Orya":"or","Osge":"osa","Rohg":"rhg","Sinh":"pi-LK si","Syrc":"syr","Taml":"ta","Tavt":"blt","Telu":"te","Tfng":"shi zgh","Thaa":"dv","Thai":"pi-TH th","Tibt":"bo dz","Vaii":"vai","Yiii":"ii"});
