export type CampusSourceKind = "map" | "official" | "photos" | "open-data";
export type CampusSource = {
  id: string;
  title: string;
  url: string;
  kind: CampusSourceKind;
  license: string;
  use: "geometry" | "dimensions" | "reference-only";
};

export const REAL_CAMPUS_SOURCES: CampusSource[] = [
  {id:"osm",title:"OpenStreetMap",url:"https://www.openstreetmap.org/copyright",kind:"open-data",license:"ODbL 1.0",use:"geometry"},
  {id:"esri-world-imagery",title:"Esri World Imagery",url:"https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9",kind:"photos",license:"reference only; source imagery is not redistributed",use:"reference-only"},
  {id:"pku-map",title:"北京大学燕园校区地图",url:"https://isdplus.pku.edu.cn/dfiles/pdf/map.pdf",kind:"map",license:"reference only",use:"reference-only"},
  {id:"pku-visit",title:"北京大学校园参观与建筑",url:"https://www.pku.edu.cn/visit.html",kind:"official",license:"reference only",use:"reference-only"},
  {id:"pku-photo",title:"北京大学影像站",url:"https://photo.pku.edu.cn/",kind:"photos",license:"reference only",use:"reference-only"},
  {id:"pku-library",title:"北京大学图书馆馆舍资料",url:"https://www.lib.pku.edu.cn/portal/cn/node/2128",kind:"official",license:"reference only",use:"dimensions"},
  {id:"pku-heritage",title:"北京大学二十世纪建筑遗产资料",url:"https://www.gotopku.cn/index/detail/871.html",kind:"official",license:"reference only",use:"reference-only"},
  {id:"pku-centennial",title:"北京大学百周年纪念讲堂工程资料",url:"https://jjgcb.pku.edu.cn/gcjs/jgxmly/32058.htm",kind:"official",license:"reference only",use:"dimensions"},
  {id:"pku-commons",title:"Wikimedia · 北京大学建筑",url:"https://commons.wikimedia.org/wiki/Category:Buildings_of_Peking_University",kind:"photos",license:"per-file license",use:"reference-only"},
  {id:"thu-map",title:"清华大学校园地图",url:"https://www.tsinghua.edu.cn/zjqh/xyfg/xydt.htm",kind:"map",license:"reference only",use:"reference-only"},
  {id:"thu-landscape",title:"清华大学校园景观",url:"https://www.tsinghua.edu.cn/zjqh/xyfg/xyjg.htm",kind:"photos",license:"reference only",use:"reference-only"},
  {id:"thu-planning",title:"清华大学1950年代校园规划与东扩",url:"https://xsg.tsinghua.edu.cn/info/1003/1156.htm",kind:"official",license:"reference only",use:"dimensions"},
  {id:"thu-main",title:"清华大学主楼",url:"https://www.tsinghua.edu.cn/info/1360/1408.htm",kind:"official",license:"reference only",use:"dimensions"},
  {id:"thu-auditorium",title:"清华大学大礼堂官方影像",url:"https://www.tsinghua.edu.cn/info/1177/93933.htm",kind:"official",license:"reference only",use:"reference-only"},
  {id:"thu-gallery",title:"大美清华组图",url:"https://www.tsinghua.edu.cn/info/1181/94400.htm",kind:"photos",license:"reference only",use:"reference-only"},
  {id:"thu-commons",title:"Wikimedia · 清华大学建筑",url:"https://commons.wikimedia.org/wiki/Category:Buildings_in_Tsinghua_University",kind:"photos",license:"per-file license",use:"reference-only"},
  {id:"open-meteo",title:"Open-Meteo Elevation API",url:"https://github.com/open-meteo/open-meteo/blob/main/openapi/elevation.yml",kind:"open-data",license:"CC BY 4.0",use:"geometry"},
];

export const sourceIdsForCampus = (campus: "pku" | "thu") => campus === "pku"
  ? ["osm","esri-world-imagery","pku-map","pku-visit","pku-photo","pku-commons"]
  : ["osm","esri-world-imagery","thu-map","thu-landscape","thu-planning","thu-gallery","thu-commons"];

export const photoSearchFor = (name: string) =>
  `https://commons.wikimedia.org/w/index.php?search=${encodeURIComponent(name)}&title=Special:MediaSearch&type=image`;
